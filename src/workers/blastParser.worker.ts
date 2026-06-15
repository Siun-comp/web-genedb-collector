import { parseBlastResultSkeleton, type BlastParseProgress, type BlastParseResult } from "../domain/blastResultParser";
import type { BlastResultFormat } from "../services/blastClient";

export interface ParserWorkerRequest {
  type: "parse";
  requestId: string;
  format: BlastResultFormat;
  text: string;
  rawLength: number;
  progressIntervalHits?: number;
}

export interface ParserWorkerProgress {
  format: BlastResultFormat;
  stage: "started" | BlastParseProgress["stage"];
  processedHits: number;
  totalHits?: number;
  records: number;
  dropped: number;
  completeHitBlocksSeen: number;
  partialXmlTail: boolean;
  rawLength: number;
  elapsedMs: number;
}

export type ParserWorkerResponse =
  | { type: "started"; requestId: string; progress: ParserWorkerProgress }
  | { type: "progress"; requestId: string; progress: ParserWorkerProgress }
  | { type: "complete"; requestId: string; result: BlastParseResult; progress: ParserWorkerProgress }
  | { type: "error"; requestId: string; message: string; elapsedMs: number };

export function handleBlastParserWorkerRequest(request: ParserWorkerRequest, postMessage: (message: ParserWorkerResponse) => void): void {
  const startedAt = Date.now();
  const elapsedMs = () => Date.now() - startedAt;

  try {
    if (request.type !== "parse") {
      postMessage({ type: "error", requestId: request.requestId, message: "Unsupported parser worker request.", elapsedMs: elapsedMs() });
      return;
    }

    const startedProgress: ParserWorkerProgress = {
      format: request.format,
      stage: "started",
      processedHits: 0,
      records: 0,
      dropped: 0,
      completeHitBlocksSeen: 0,
      partialXmlTail: false,
      rawLength: request.rawLength,
      elapsedMs: elapsedMs()
    };
    postMessage({ type: "started", requestId: request.requestId, progress: startedProgress });

    let latestProgress = startedProgress;
    const result = parseBlastResultSkeleton(request.text, request.format, {
      progressIntervalHits: request.progressIntervalHits,
      onProgress: (progress) => {
        latestProgress = {
          format: request.format,
          stage: progress.stage,
          processedHits: progress.processedHits,
          totalHits: progress.totalHits,
          records: progress.records,
          dropped: progress.dropped,
          completeHitBlocksSeen: progress.completeHitBlocksSeen,
          partialXmlTail: progress.partialXmlTail,
          rawLength: request.rawLength,
          elapsedMs: elapsedMs()
        };
        postMessage({ type: "progress", requestId: request.requestId, progress: latestProgress });
      }
    });

    const completeProgress: ParserWorkerProgress = {
      ...latestProgress,
      stage: "complete",
      processedHits: result.diagnostics?.completeHitBlocksSeen ?? result.records.length + result.dropped.length,
      records: result.records.length,
      dropped: result.dropped.length,
      completeHitBlocksSeen: result.diagnostics?.completeHitBlocksSeen ?? latestProgress.completeHitBlocksSeen,
      partialXmlTail: result.diagnostics?.partialXmlTail ?? latestProgress.partialXmlTail,
      elapsedMs: elapsedMs()
    };
    postMessage({ type: "complete", requestId: request.requestId, result, progress: completeProgress });
  } catch (error) {
    postMessage({ type: "error", requestId: request.requestId, message: safeErrorMessage(error), elapsedMs: elapsedMs() });
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? `${error.name ? `${error.name}: ` : ""}${error.message}` : String(error);
  return message
    .replace(/RAW_BLAST_RESULT_TEXT/gi, "[redacted_raw_result]")
    .replace(/\b[ACGTUNRYSWKMBDHV]{20,}\b/gi, "[redacted_sequence]");
}

const workerScope = globalThis as DedicatedWorkerGlobalScope & typeof globalThis;

if (typeof workerScope.addEventListener === "function" && typeof workerScope.postMessage === "function") {
  workerScope.addEventListener("message", (event: MessageEvent<ParserWorkerRequest>) => {
    handleBlastParserWorkerRequest(event.data, (message) => workerScope.postMessage(message));
  });
}
