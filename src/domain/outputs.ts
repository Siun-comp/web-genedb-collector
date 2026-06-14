import { APP_NAME, APP_VERSION } from "../config/defaults";
import type { BlastParseResult, ParsedHsp } from "./blastResultParser";
import { buildEntrezQuery, cleanSequence, hashSequence, wrapSequence } from "./fasta";
import { parseKeywords } from "./filters";
import type { CollectionFormState, ParserSummary } from "./types";

export interface OutputContext {
  rid?: string;
  resultFormat?: string;
  resultDownloadedAt?: number;
  resultRawLength?: number;
  queryLength?: number;
  queryHash?: string;
  processLogs: string[];
}

export type OutputDisposition = "aligned" | "ambiguous" | "length_dropped" | "keyword_dropped";

export interface OutputRecordMeta {
  outputIndex: number;
  accession: string;
  title: string;
  header: string;
  disposition: OutputDisposition;
  sequenceLength: number;
  hspIndex: number;
  sequenceSource: ParsedHsp["sequenceSource"];
  hitRange?: [number, number];
  queryRange?: [number, number];
  identity?: number;
  evalue?: number;
  bitScore?: number;
  dropReason?: string;
}

export interface GeneDbOutputBundle {
  fileNames: ReturnType<typeof outputFileNames>;
  alignedFasta: string;
  ambiguousFasta: string;
  metaJson: string;
  runInfoJson: string;
  processLog: string;
  summary: ParserSummary;
  records: OutputRecordMeta[];
  parserDroppedCount: number;
}

export function safeTaskName(taskName: string): string {
  const trimmed = taskName.trim() || "Gene_Collection";
  const safe = trimmed
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return safe || "Gene_Collection";
}

export function outputFileNames(taskName: string): string[] {
  const safeName = safeTaskName(taskName);
  return [
    `${safeName}_Aligned.fasta`,
    `${safeName}_excluded_ambiguous.fasta`,
    `${safeName}_meta.json`,
    "run_info.json",
    "process.log"
  ];
}

export function buildRunInfo(state: CollectionFormState, rid: string | undefined, counts?: ParserSummary) {
  return {
    TaskID: safeTaskName(state.taskName),
    Date: new Date().toISOString(),
    RID: rid ?? null,
    App: APP_NAME,
    AppVersion: APP_VERSION,
    Options: {
      db: state.database,
      task: state.task,
      max_hits: state.maxHits,
      expect: state.expect,
      word_size: state.wordSize,
      use_len_filter: state.lengthFilterEnabled,
      min_len_pct: state.minLengthPercent,
      max_len_pct: state.maxLengthPercent,
      use_kw_filter: state.keywordFilterEnabled,
      keywords: state.keywords,
      exclude_ambiguous: state.excludeAmbiguousN
    },
    Counts: counts ?? null
  };
}

export function buildGeneDbOutputBundle(state: CollectionFormState, parseResult: BlastParseResult, context: OutputContext): GeneDbOutputBundle {
  const queryLength = context.queryLength ?? cleanSequence(state.referenceSequence).length;
  const queryHash = context.queryHash ?? hashSequence(state.referenceSequence);
  const keywords = parseKeywords(state.keywords).map((keyword) => keyword.toLowerCase());
  const lengthBounds = getLengthBounds(state, queryLength);
  const outputRecords: OutputRecordMeta[] = [];
  const alignedEntries: string[] = [];
  const ambiguousEntries: string[] = [];
  let lengthDroppedCount = 0;
  let keywordDroppedCount = 0;
  let ambiguousCount = 0;
  const headerCounts = new Map<string, number>();

  parseResult.records.forEach((record, index) => {
    const header = buildUniqueGeneDbFastaHeader(record, headerCounts);
    const sequenceLength = record.sequence.length;
    const keyword = state.keywordFilterEnabled ? keywords.find((item) => record.title.toLowerCase().includes(item)) : undefined;
    const isLengthDropped =
      state.lengthFilterEnabled && lengthBounds ? sequenceLength < lengthBounds.minBp || sequenceLength > lengthBounds.maxBp : false;
    const isAmbiguous = state.excludeAmbiguousN && record.sequence.includes("N");
    let disposition: OutputDisposition = "aligned";
    let dropReason: string | undefined;

    if (isLengthDropped) {
      disposition = "length_dropped";
      dropReason = `Length ${sequenceLength} bp outside ${lengthBounds?.minBp}-${lengthBounds?.maxBp} bp`;
      lengthDroppedCount += 1;
    } else if (keyword) {
      disposition = "keyword_dropped";
      dropReason = `Title contains excluded keyword: ${keyword}`;
      keywordDroppedCount += 1;
    } else if (isAmbiguous) {
      disposition = "ambiguous";
      ambiguousCount += 1;
      ambiguousEntries.push(formatFastaEntry(header, record.sequence));
    } else {
      alignedEntries.push(formatFastaEntry(header, record.sequence));
    }

    outputRecords.push(buildRecordMeta(record, index + 1, header, disposition, dropReason));
  });

  const alignedCount = outputRecords.filter((record) => record.disposition === "aligned").length;
  const droppedCount = parseResult.dropped.length + lengthDroppedCount + keywordDroppedCount;
  const outputLengths = outputRecords.filter((record) => record.disposition === "aligned").map((record) => record.sequenceLength);
  const summary: ParserSummary = {
    savedCount: alignedCount,
    droppedCount,
    ambiguousCount,
    uniqueCount: new Set(parseResult.records.map((record) => record.sequence)).size,
    lengthDroppedCount,
    keywordDroppedCount,
    minLength: outputLengths.length ? Math.min(...outputLengths) : 0,
    maxLength: outputLengths.length ? Math.max(...outputLengths) : 0
  };
  const runInfo = buildRunInfo(state, context.rid, summary);
  const meta = buildMetaJson(state, parseResult, context, summary, outputRecords, queryLength, queryHash, lengthBounds);
  const log = buildProcessLog(state, parseResult, context, summary, queryLength, queryHash);

  return {
    fileNames: outputFileNames(state.taskName) as GeneDbOutputBundle["fileNames"],
    alignedFasta: alignedEntries.join("\n"),
    ambiguousFasta: ambiguousEntries.join("\n"),
    metaJson: JSON.stringify(meta, null, 2),
    runInfoJson: JSON.stringify(runInfo, null, 2),
    processLog: log,
    summary,
    records: outputRecords,
    parserDroppedCount: parseResult.dropped.length
  };
}

function getLengthBounds(state: CollectionFormState, queryLength: number): { minBp: number; maxBp: number } | null {
  if (!state.lengthFilterEnabled || queryLength <= 0) return null;
  return {
    minBp: Math.floor(queryLength * (state.minLengthPercent / 100)),
    maxBp: Math.ceil(queryLength * (state.maxLengthPercent / 100))
  };
}

function buildUniqueGeneDbFastaHeader(record: ParsedHsp, headerCounts: Map<string, number>): string {
  const title = normalizeHeaderPart(record.title || "unknown_description");
  const accession = normalizeHeaderPart(record.accession || "unknown_accession");
  const baseHeader = `${title}_${accession}`;
  const nextCount = (headerCounts.get(baseHeader) ?? 0) + 1;
  headerCounts.set(baseHeader, nextCount);
  return nextCount === 1 ? baseHeader : `${baseHeader}_${nextCount}`;
}

function normalizeHeaderPart(value: string): string {
  const normalized = value.replace(/\s+/g, "_").replace(/[^\w.\-|]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

function formatFastaEntry(header: string, sequence: string): string {
  return `>${header}\n${wrapSequence(sequence)}\n`;
}

function buildRecordMeta(record: ParsedHsp, outputIndex: number, header: string, disposition: OutputDisposition, dropReason?: string): OutputRecordMeta {
  return {
    outputIndex,
    accession: record.accession,
    title: record.title,
    header,
    disposition,
    sequenceLength: record.sequence.length,
    hspIndex: record.hspIndex,
    sequenceSource: record.sequenceSource,
    hitRange: record.hitRange,
    queryRange: record.queryRange,
    identity: record.identity,
    evalue: record.evalue,
    bitScore: record.bitScore,
    dropReason
  };
}

function buildMetaJson(
  state: CollectionFormState,
  parseResult: BlastParseResult,
  context: OutputContext,
  summary: ParserSummary,
  records: OutputRecordMeta[],
  queryLength: number,
  queryHash: string,
  lengthBounds: { minBp: number; maxBp: number } | null
) {
  return {
    taskId: safeTaskName(state.taskName),
    createdAt: new Date().toISOString(),
    app: APP_NAME,
    appVersion: APP_VERSION,
    rid: context.rid ?? null,
    ncbiRequestSummary: {
      program: "blastn",
      database: state.database,
      task: state.task,
      hitlistSize: state.maxHits,
      expect: state.expect,
      wordSize: state.wordSize,
      entrezQuery: buildEntrezQuery(state.taxid),
      tool: state.tool,
      emailProvided: Boolean(state.email.trim()),
      queryLength,
      queryHash
    },
    resultSummary: {
      format: context.resultFormat ?? parseResult.format,
      downloadedAt: context.resultDownloadedAt ? new Date(context.resultDownloadedAt).toISOString() : null,
      responseLength: context.resultRawLength ?? null
    },
    filters: {
      lengthFilterEnabled: state.lengthFilterEnabled,
      minLengthPercent: state.minLengthPercent,
      maxLengthPercent: state.maxLengthPercent,
      lengthBounds,
      keywordFilterEnabled: state.keywordFilterEnabled,
      keywords: parseKeywords(state.keywords),
      excludeAmbiguousN: state.excludeAmbiguousN
    },
    counts: summary,
    records,
    parserDropped: parseResult.dropped
  };
}

function buildProcessLog(
  state: CollectionFormState,
  parseResult: BlastParseResult,
  context: OutputContext,
  summary: ParserSummary,
  queryLength: number,
  queryHash: string
): string {
  const lines = [
    `${new Date().toISOString()} Output generated.`,
    `Task=${safeTaskName(state.taskName)}`,
    `RID=${context.rid ?? "none"}`,
    `Query length=${queryLength} bp`,
    `Query hash=${queryHash}`,
    `Taxid=${state.taxid.trim()}`,
    `Result format=${context.resultFormat ?? parseResult.format}`,
    `Result response length=${context.resultRawLength ?? "unknown"}`,
    `Counts saved=${summary.savedCount}, ambiguous=${summary.ambiguousCount}, dropped=${summary.droppedCount}, unique=${summary.uniqueCount}, lengthDropped=${summary.lengthDroppedCount}, keywordDropped=${summary.keywordDroppedCount}`,
    `Filters length=${state.lengthFilterEnabled ? `${state.minLengthPercent}-${state.maxLengthPercent}%` : "off"}, keyword=${state.keywordFilterEnabled ? parseKeywords(state.keywords).join("|") || "none" : "off"}, ambiguousN=${state.excludeAmbiguousN ? "exclude" : "include"}`,
    ...parseResult.logs.map((line) => `Parser: ${redactSequence(line, state.referenceSequence)}`),
    ...context.processLogs.map((line) => `Process: ${redactSequence(line, state.referenceSequence)}`)
  ];
  return `${lines.join("\n")}\n`;
}

function redactSequence(value: string, referenceSequence: string): string {
  const cleaned = cleanSequence(referenceSequence);
  if (!cleaned || cleaned.length < 8) return value;
  return value.split(cleaned).join("[redacted_query_sequence]");
}
