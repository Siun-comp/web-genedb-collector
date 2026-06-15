import {
  buildXmlBlastParseResult,
  parseXmlHitBlock,
  type BlastParseResult,
  type DroppedHit,
  type ParsedHsp
} from "./blastResultParser";

export type BlastXmlStreamProgressStage = "stream_started" | "reading_chunks" | "parsing_hits" | "complete";

export interface BlastXmlStreamProgress {
  stage: BlastXmlStreamProgressStage;
  chunksRead: number;
  rawLength: number;
  processedHits: number;
  records: number;
  dropped: number;
  completeHitBlocksSeen: number;
  partialXmlTail: boolean;
  elapsedMs: number;
}

export interface BlastXmlStreamParseOptions {
  progressIntervalHits?: number;
  onProgress?: (progress: BlastXmlStreamProgress) => void;
  salvagePartialOnReadError?: boolean;
}

interface StreamState {
  startedAt: number;
  chunksRead: number;
  rawLength: number;
  processedHits: number;
  records: ParsedHsp[];
  dropped: DroppedHit[];
  completeHitBlocksSeen: number;
  sawBlastOutputClose: boolean;
}

export async function parseBlastXmlReadableStream(stream: ReadableStream<Uint8Array>, options: BlastXmlStreamParseOptions = {}): Promise<BlastParseResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const state: StreamState = {
    startedAt: Date.now(),
    chunksRead: 0,
    rawLength: 0,
    processedHits: 0,
    records: [],
    dropped: [],
    completeHitBlocksSeen: 0,
    sawBlastOutputClose: false
  };
  let buffer = "";
  const parserWarnings: string[] = [];

  emitStreamProgress(options, state, "stream_started", false);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkText = decoder.decode(value, { stream: true });
      state.chunksRead += 1;
      state.rawLength += chunkText.length;
      state.sawBlastOutputClose ||= chunkText.includes("</BlastOutput>");
      buffer += chunkText;
      state.sawBlastOutputClose ||= buffer.includes("</BlastOutput>");
      buffer = consumeCompleteHitBlocks(buffer, state, options);
      emitStreamProgress(options, state, "reading_chunks", !state.sawBlastOutputClose);
    }

    const tailText = decoder.decode();
    if (tailText) {
      state.rawLength += tailText.length;
      state.sawBlastOutputClose ||= tailText.includes("</BlastOutput>");
      buffer += tailText;
      state.sawBlastOutputClose ||= buffer.includes("</BlastOutput>");
      buffer = consumeCompleteHitBlocks(buffer, state, options);
    }
  } catch (error) {
    if ((options.salvagePartialOnReadError ?? true) && state.completeHitBlocksSeen > 0) {
      parserWarnings.push(`ReadableStream ended before the full XML result was available; recovered complete Hit blocks only. reason=${safeStreamError(error)}`);
      return finishStreamParse(state, true, parserWarnings, options);
    }
    throw new Error(`XML stream read failed before any complete Hit block could be recovered. reason=${safeStreamError(error)}`);
  } finally {
    reader.releaseLock();
  }

  const partialXmlTail = !state.sawBlastOutputClose || hasPartialHitTail(buffer);
  if (partialXmlTail) {
    parserWarnings.push("XML stream did not include a complete closing </BlastOutput>; parsed complete Hit blocks only.");
  }
  return finishStreamParse(state, partialXmlTail, parserWarnings, options);
}

function consumeCompleteHitBlocks(buffer: string, state: StreamState, options: BlastXmlStreamParseOptions): string {
  let remaining = buffer;

  while (true) {
    const start = remaining.search(/<Hit\b/);
    if (start === -1) {
      return keepPossibleSplitHitPrefix(remaining);
    }

    const end = remaining.indexOf("</Hit>", start);
    if (end === -1) {
      return remaining.slice(start);
    }

    const hitBlock = remaining.slice(start, end + "</Hit>".length);
    const parsedHit = parseXmlHitBlock(hitBlock);
    state.completeHitBlocksSeen += 1;
    state.processedHits += 1;
    if (parsedHit.record) {
      state.records.push(parsedHit.record);
    } else {
      state.dropped.push(parsedHit.dropped ?? { reason: "No usable first HSP sequence" });
    }
    maybeEmitStreamProgress(options, state, "parsing_hits", !state.sawBlastOutputClose);
    remaining = remaining.slice(end + "</Hit>".length);
  }
}

function finishStreamParse(state: StreamState, partialXmlTail: boolean, parserWarnings: string[], options: BlastXmlStreamParseOptions): BlastParseResult {
  emitStreamProgress(options, state, "complete", partialXmlTail);
  if (state.completeHitBlocksSeen === 0) {
    return buildXmlBlastParseResult(
      [],
      [{ reason: "XML parse failed: no complete Hit blocks found" }],
      0,
      partialXmlTail,
      parserWarnings.length ? parserWarnings : ["XML stream parser found no complete Hit blocks."]
    );
  }
  return buildXmlBlastParseResult(state.records, state.dropped, state.completeHitBlocksSeen, partialXmlTail, parserWarnings);
}

function keepPossibleSplitHitPrefix(value: string): string {
  return value.slice(Math.max(0, value.length - Math.max(4, "</BlastOutput>".length - 1)));
}

function hasPartialHitTail(buffer: string): boolean {
  return /<Hit\b/.test(buffer);
}

function maybeEmitStreamProgress(options: BlastXmlStreamParseOptions, state: StreamState, stage: BlastXmlStreamProgressStage, partialXmlTail: boolean): void {
  const interval = Math.max(1, Math.floor(options.progressIntervalHits ?? 1000));
  if (state.processedHits === 0 || state.processedHits % interval === 0) {
    emitStreamProgress(options, state, stage, partialXmlTail);
  }
}

function emitStreamProgress(options: BlastXmlStreamParseOptions, state: StreamState, stage: BlastXmlStreamProgressStage, partialXmlTail: boolean): void {
  options.onProgress?.({
    stage,
    chunksRead: state.chunksRead,
    rawLength: state.rawLength,
    processedHits: state.processedHits,
    records: state.records.length,
    dropped: state.dropped.length,
    completeHitBlocksSeen: state.completeHitBlocksSeen,
    partialXmlTail,
    elapsedMs: Date.now() - state.startedAt
  });
}

function safeStreamError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/RAW_BLAST_RESULT_TEXT/gi, "[redacted_raw_result]")
    .replace(/\b[ACGTUNRYSWKMBDHV]{20,}\b/gi, "[redacted_sequence]");
}
