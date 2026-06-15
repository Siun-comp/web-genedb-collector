import type { ParserSummary } from "./types";
import type { BlastResultFormat } from "../services/blastClient";

export interface ParsedHsp {
  accession: string;
  title: string;
  hspIndex: number;
  sequence: string;
  sequenceSource: "hseq" | "qseq";
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
}

export function parseBlastResultSkeleton(text: string, format: BlastResultFormat): BlastParseResult {
  return format === "JSON2_S" ? parseJson2Skeleton(text, format) : parseXmlSkeleton(text, format);
}

function parseJson2Skeleton(text: string, format: BlastResultFormat): BlastParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyResult(format, "JSON parse failed");
  }

  const hitObjects = findObjectsWithArrayKey(parsed, "hsps");
  const records: ParsedHsp[] = [];
  const dropped: DroppedHit[] = [];

  for (const hit of hitObjects) {
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
  }

  return buildResult(format, records, dropped, [`Parsed JSON2_S skeleton: hits=${hitObjects.length}, records=${records.length}`]);
}

function parseXmlSkeleton(text: string, format: BlastResultFormat): BlastParseResult {
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
  const sequence = removeGaps(hseq || qseq || "");
  if (!sequenceSource || !sequence) return null;

  return {
    accession,
    title,
    hspIndex: 0,
    sequence,
    sequenceSource,
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
  const sequence = removeGaps(hseq || qseq || "");
  if (!sequenceSource || !sequence) return null;

  return {
    accession,
    title,
    hspIndex: 0,
    sequence,
    sequenceSource,
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

function removeGaps(sequence: string): string {
  return sequence.replace(/-/g, "").toUpperCase();
}

function buildResult(format: BlastResultFormat, records: ParsedHsp[], dropped: DroppedHit[], logs: string[], diagnostics?: BlastParseDiagnostics): BlastParseResult {
  const lengths = records.map((record) => record.sequence.length);
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
    diagnostics
  };
}

function emptyResult(format: BlastResultFormat, reason: string, diagnostics?: BlastParseDiagnostics): BlastParseResult {
  return buildResult(format, [], [{ reason }], [reason], diagnostics);
}
