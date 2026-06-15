import type { ParserSummary } from "./types";
import type { BlastResultFormat } from "../services/blastClient";

export interface ParsedHsp {
  accession: string;
  title: string;
  hspIndex: number;
  sequence: string;
  sequenceSource: "hseq" | "qseq";
  sequenceNormalization?: ParsedHspSequenceNormalization;
  hitRange?: [number, number];
  queryRange?: [number, number];
  identity?: number;
  evalue?: number;
  bitScore?: number;
}

export interface DroppedHit {
  reason: string;
  accession?: string;
  title?: string;
}

export interface BlastParseResult {
  format: BlastResultFormat;
  records: ParsedHsp[];
  dropped: DroppedHit[];
  summary: ParserSummary;
  logs: string[];
  diagnostics?: BlastParseDiagnostics;
}

export interface BlastParseDiagnostics {
  completeHitBlocksSeen: number;
  partialXmlTail: boolean;
  parserWarnings: string[];
  qseqFallbackCount?: number;
  resultSequenceNormalization?: ResultSequenceNormalizationSummary;
}

export type BlastParseProgressStage = "json_hits_discovered" | "parsing_hits" | "complete";

export interface BlastParseProgress {
  stage: BlastParseProgressStage;
  processedHits: number;
  totalHits?: number;
  records: number;
  dropped: number;
  completeHitBlocksSeen: number;
  partialXmlTail: boolean;
}

export interface BlastParseOptions {
  progressIntervalHits?: number;
  onProgress?: (progress: BlastParseProgress) => void;
}

export type ResultSequenceOutputMode = "u_to_t";

export interface ParsedHspSequenceNormalization {
  outputMode: ResultSequenceOutputMode;
  uToTCount: number;
  nCount: number;
  otherIupacAmbiguityCount: number;
  invalidCharacterCount: number;
}

export interface ResultSequenceNormalizationSummary extends ParsedHspSequenceNormalization {
  recordCount: number;
  qseqFallbackCount: number;
  ambiguousPolicy: "n_only";
}

interface NormalizedParsedHspSequence {
  sequence: string;
  normalization: ParsedHspSequenceNormalization;
  invalidCharacters: string[];
}

export function parseBlastResultSkeleton(text: string, format: BlastResultFormat, options: BlastParseOptions = {}): BlastParseResult {
  const result = format === "JSON2_S" ? parseJson2Skeleton(text, format, options) : parseXmlSkeleton(text, format, options);
  emitProgress(options, {
    stage: "complete",
    processedHits: result.records.length + result.dropped.length,
    records: result.records.length,
    dropped: result.dropped.length,
    completeHitBlocksSeen: result.diagnostics?.completeHitBlocksSeen ?? 0,
    partialXmlTail: result.diagnostics?.partialXmlTail ?? false
  });
  return result;
}

function parseJson2Skeleton(text: string, format: BlastResultFormat, options: BlastParseOptions): BlastParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyResult(format, "JSON parse failed");
  }

  const hitObjects = findObjectsWithArrayKey(parsed, "hsps");
  const records: ParsedHsp[] = [];
  const dropped: DroppedHit[] = [];
  emitProgress(options, {
    stage: "json_hits_discovered",
    processedHits: 0,
    totalHits: hitObjects.length,
    records: 0,
    dropped: 0,
    completeHitBlocksSeen: 0,
    partialXmlTail: false
  });

  for (const [index, hit] of hitObjects.entries()) {
    const title = readJsonTitle(hit);
    const accession = readJsonAccession(hit);
    const hsps = Array.isArray(hit.hsps) ? hit.hsps : [];
    const hsp = hsps[0];
    const parsedHsp = hsp && typeof hsp === "object" ? parseJsonHsp(hsp as Record<string, unknown>, accession, title) : null;
    if (parsedHsp) {
      records.push(parsedHsp);
    } else {
      dropped.push({ accession, title, reason: "No usable first HSP sequence" });
    }
    maybeEmitProgress(options, {
      stage: "parsing_hits",
      processedHits: index + 1,
      totalHits: hitObjects.length,
      records: records.length,
      dropped: dropped.length,
      completeHitBlocksSeen: 0,
      partialXmlTail: false
    });
  }

  return buildResult(format, records, dropped, [`Parsed JSON2_S skeleton: hits=${hitObjects.length}, records=${records.length}`]);
}

function parseXmlSkeleton(text: string, format: BlastResultFormat, options: BlastParseOptions): BlastParseResult {
  const trimmed = text.trim();
  if (!trimmed.startsWith("<")) {
    return emptyResult(format, "XML parse failed: response does not look like XML", {
      completeHitBlocksSeen: 0,
      partialXmlTail: false,
      parserWarnings: ["XML response does not start with '<'."]
    });
  }

  const records: ParsedHsp[] = [];
  const dropped: DroppedHit[] = [];
  const parserWarnings: string[] = [];
  const partialXmlTail = !/<\/BlastOutput>\s*$/.test(trimmed);
  const hitPattern = /<Hit\b[\s\S]*?<\/Hit>/g;
  let completeHitBlocksSeen = 0;
  let match: RegExpExecArray | null;

  while ((match = hitPattern.exec(text)) !== null) {
    const hitBlock = match[0];
    completeHitBlocksSeen += 1;
    const accession = readXmlTag(hitBlock, "Hit_accession") || readXmlTag(hitBlock, "Hit_id") || "unknown_accession";
    const title = readXmlTag(hitBlock, "Hit_def") || readXmlTag(hitBlock, "Hit_title") || accession;
    const hspBlock = hitBlock.match(/<Hsp\b[\s\S]*?<\/Hsp>/)?.[0];
    const parsedHsp = hspBlock ? parseXmlHsp(hspBlock, accession, title) : null;
    if (parsedHsp) {
      records.push(parsedHsp);
    } else {
      dropped.push({ accession, title, reason: "No usable first HSP sequence" });
    }
    maybeEmitProgress(options, {
      stage: "parsing_hits",
      processedHits: completeHitBlocksSeen,
      records: records.length,
      dropped: dropped.length,
      completeHitBlocksSeen,
      partialXmlTail
    });
  }

  if (partialXmlTail) {
    parserWarnings.push("XML response did not include closing </BlastOutput>; parsed complete Hit blocks only.");
  }

  if (completeHitBlocksSeen === 0) {
    return emptyResult(format, "XML parse failed: no complete Hit blocks found", {
      completeHitBlocksSeen,
      partialXmlTail,
      parserWarnings
    });
  }

  return buildResult(
    format,
    records,
    dropped,
    [`Parsed XML blocks: completeHits=${completeHitBlocksSeen}, records=${records.length}, partialXmlTail=${partialXmlTail}`, ...parserWarnings],
    {
      completeHitBlocksSeen,
      partialXmlTail,
      parserWarnings
    }
  );
}

function parseJsonHsp(hsp: Record<string, unknown>, accession: string, title: string): ParsedHsp | null {
  const hseq = readString(hsp, ["hseq", "Hsp_hseq"]);
  const qseq = readString(hsp, ["qseq", "Hsp_qseq"]);
  const sequenceSource = hseq ? "hseq" : qseq ? "qseq" : null;
  const normalized = normalizeParsedHspSequence(hseq || qseq || "");
  if (!sequenceSource || !normalized.sequence || normalized.invalidCharacters.length > 0) return null;

  return {
    accession,
    title,
    hspIndex: 0,
    sequence: normalized.sequence,
    sequenceSource,
    sequenceNormalization: normalized.normalization,
    hitRange: readRange(hsp, ["hit_from", "Hsp_hit-from"], ["hit_to", "Hsp_hit-to"]),
    queryRange: readRange(hsp, ["query_from", "Hsp_query-from"], ["query_to", "Hsp_query-to"]),
    identity: readNumber(hsp, ["identity", "Hsp_identity"]),
    evalue: readNumber(hsp, ["evalue", "Hsp_evalue"]),
    bitScore: readNumber(hsp, ["bit_score", "Hsp_bit-score", "bitScore"])
  };
}

function parseXmlHsp(hspBlock: string, accession: string, title: string): ParsedHsp | null {
  const hseq = readXmlTag(hspBlock, "Hsp_hseq");
  const qseq = readXmlTag(hspBlock, "Hsp_qseq");
  const sequenceSource = hseq ? "hseq" : qseq ? "qseq" : null;
  const normalized = normalizeParsedHspSequence(hseq || qseq || "");
  if (!sequenceSource || !normalized.sequence || normalized.invalidCharacters.length > 0) return null;

  return {
    accession,
    title,
    hspIndex: 0,
    sequence: normalized.sequence,
    sequenceSource,
    sequenceNormalization: normalized.normalization,
    hitRange: xmlRange(hspBlock, "Hsp_hit-from", "Hsp_hit-to"),
    queryRange: xmlRange(hspBlock, "Hsp_query-from", "Hsp_query-to"),
    identity: xmlNumber(hspBlock, "Hsp_identity"),
    evalue: xmlNumber(hspBlock, "Hsp_evalue"),
    bitScore: xmlNumber(hspBlock, "Hsp_bit-score")
  };
}

function findObjectsWithArrayKey(value: unknown, key: string): Array<Record<string, unknown>> {
  const matches: Array<Record<string, unknown>> = [];

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (!current || typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    if (Array.isArray(record[key])) {
      matches.push(record);
    }
    for (const item of Object.values(record)) visit(item);
  }

  visit(value);
  return matches;
}

function readJsonTitle(hit: Record<string, unknown>): string {
  const direct = readString(hit, ["title", "description", "Hit_def"]);
  if (direct) return direct;
  const descriptions = hit.description;
  if (Array.isArray(descriptions) && descriptions[0] && typeof descriptions[0] === "object") {
    return readString(descriptions[0] as Record<string, unknown>, ["title", "id", "accession"]) || "unknown_title";
  }
  return "unknown_title";
}

function readJsonAccession(hit: Record<string, unknown>): string {
  const direct = readString(hit, ["accession", "id", "Hit_accession"]);
  if (direct) return direct;
  const descriptions = hit.description;
  if (Array.isArray(descriptions) && descriptions[0] && typeof descriptions[0] === "object") {
    return readString(descriptions[0] as Record<string, unknown>, ["accession", "id", "title"]) || "unknown_accession";
  }
  return "unknown_accession";
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readRange(record: Record<string, unknown>, fromKeys: string[], toKeys: string[]): [number, number] | undefined {
  const from = readNumber(record, fromKeys);
  const to = readNumber(record, toKeys);
  return from !== undefined && to !== undefined ? [from, to] : undefined;
}

function readXmlTag(block: string, tag: string): string {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`<${escapedTag}>([\\s\\S]*?)<\\/${escapedTag}>`))?.[1]?.trim() ?? "";
}

function xmlNumber(block: string, tag: string): number | undefined {
  const parsed = Number(readXmlTag(block, tag));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function xmlRange(block: string, fromTag: string, toTag: string): [number, number] | undefined {
  const from = xmlNumber(block, fromTag);
  const to = xmlNumber(block, toTag);
  return from !== undefined && to !== undefined ? [from, to] : undefined;
}

export function normalizeParsedHspSequence(sequence: string): NormalizedParsedHspSequence {
  const uppercase = sequence.replace(/[\s-]/g, "").toUpperCase();
  const uToTCount = countMatches(uppercase, "U");
  const normalized = uppercase.replace(/U/g, "T");
  const invalidCharacters = uniqueCharacters(normalized).filter((char) => !IUPAC_DNA_BASES.has(char));

  return {
    sequence: normalized,
    normalization: {
      outputMode: "u_to_t",
      uToTCount,
      nCount: countMatches(normalized, "N"),
      otherIupacAmbiguityCount: [...normalized].filter((char) => OTHER_IUPAC_AMBIGUITY_BASES.has(char)).length,
      invalidCharacterCount: [...normalized].filter((char) => !IUPAC_DNA_BASES.has(char)).length
    },
    invalidCharacters
  };
}

function buildResult(format: BlastResultFormat, records: ParsedHsp[], dropped: DroppedHit[], logs: string[], diagnostics?: BlastParseDiagnostics): BlastParseResult {
  const lengths = records.map((record) => record.sequence.length);
  const normalizedDiagnostics = withSequenceDiagnostics(records, diagnostics);
  return {
    format,
    records,
    dropped,
    logs,
    summary: {
      savedCount: records.length,
      droppedCount: dropped.length,
      ambiguousCount: 0,
      uniqueCount: new Set(records.map((record) => record.sequence)).size,
      lengthDroppedCount: 0,
      keywordDroppedCount: 0,
      minLength: lengths.length ? Math.min(...lengths) : 0,
      maxLength: lengths.length ? Math.max(...lengths) : 0
    },
    diagnostics: normalizedDiagnostics
  };
}

function emptyResult(format: BlastResultFormat, reason: string, diagnostics?: BlastParseDiagnostics): BlastParseResult {
  return buildResult(format, [], [{ reason }], [reason], diagnostics);
}

function withSequenceDiagnostics(records: ParsedHsp[], diagnostics?: BlastParseDiagnostics): BlastParseDiagnostics {
  const resultSequenceNormalization = summarizeResultSequenceNormalization(records);
  const parserWarnings = [...(diagnostics?.parserWarnings ?? [])];

  if (resultSequenceNormalization.uToTCount > 0) {
    parserWarnings.push(`RNA U bases in BLAST result HSPs were converted to DNA T. count=${resultSequenceNormalization.uToTCount}`);
  }
  if (resultSequenceNormalization.qseqFallbackCount > 0) {
    parserWarnings.push(`Hsp_hseq was missing for ${resultSequenceNormalization.qseqFallbackCount} record(s); Hsp_qseq fallback was saved with sequenceSource=qseq.`);
  }
  if (resultSequenceNormalization.otherIupacAmbiguityCount > 0) {
    parserWarnings.push(`Non-N IUPAC ambiguity bases were detected but kept in aligned output. count=${resultSequenceNormalization.otherIupacAmbiguityCount}, ambiguousPolicy=N-only.`);
  }

  return {
    completeHitBlocksSeen: diagnostics?.completeHitBlocksSeen ?? 0,
    partialXmlTail: diagnostics?.partialXmlTail ?? false,
    parserWarnings: [...new Set(parserWarnings)],
    qseqFallbackCount: resultSequenceNormalization.qseqFallbackCount,
    resultSequenceNormalization
  };
}

function summarizeResultSequenceNormalization(records: ParsedHsp[]): ResultSequenceNormalizationSummary {
  return records.reduce<ResultSequenceNormalizationSummary>(
    (summary, record) => {
      const normalization = record.sequenceNormalization ?? normalizeParsedHspSequence(record.sequence).normalization;
      summary.recordCount += 1;
      summary.uToTCount += normalization.uToTCount;
      summary.nCount += normalization.nCount;
      summary.otherIupacAmbiguityCount += normalization.otherIupacAmbiguityCount;
      summary.invalidCharacterCount += normalization.invalidCharacterCount;
      if (record.sequenceSource === "qseq") summary.qseqFallbackCount += 1;
      return summary;
    },
    {
      outputMode: "u_to_t",
      recordCount: 0,
      uToTCount: 0,
      nCount: 0,
      otherIupacAmbiguityCount: 0,
      invalidCharacterCount: 0,
      qseqFallbackCount: 0,
      ambiguousPolicy: "n_only"
    }
  );
}

function countMatches(value: string, target: string): number {
  return [...value].filter((char) => char === target).length;
}

function maybeEmitProgress(options: BlastParseOptions, progress: BlastParseProgress): void {
  const interval = Math.max(1, Math.floor(options.progressIntervalHits ?? 1000));
  if (progress.processedHits === 0 || progress.processedHits % interval === 0) {
    emitProgress(options, progress);
  }
}

function emitProgress(options: BlastParseOptions, progress: BlastParseProgress): void {
  options.onProgress?.(progress);
}

function uniqueCharacters(value: string): string[] {
  return [...new Set([...value])].sort();
}

const IUPAC_DNA_BASES = new Set(["A", "C", "G", "T", "N", "R", "Y", "S", "W", "K", "M", "B", "D", "H", "V"]);
const OTHER_IUPAC_AMBIGUITY_BASES = new Set(["R", "Y", "S", "W", "K", "M", "B", "D", "H", "V"]);
