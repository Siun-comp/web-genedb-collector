import { describe, expect, it } from "vitest";
import { BLAST_DEFAULTS, FILTER_DEFAULTS } from "../src/config/defaults";
import { normalizeParsedHspSequence, type BlastParseResult, type ParsedHsp } from "../src/domain/blastResultParser";
import { buildGeneDbOutputBundle, outputFileNames, safeTaskName, type GeneDbOutputBundle } from "../src/domain/outputs";
import type { CollectionFormState } from "../src/domain/types";

describe("output helpers", () => {
  it("sanitizes task names for output files", () => {
    expect(safeTaskName("A/B:C")).toBe("A_B_C");
  });

  it("falls back when task name is blank or only unsafe characters", () => {
    expect(safeTaskName("   ")).toBe("Gene_Collection");
    expect(safeTaskName("////")).toBe("Gene_Collection");
  });

  it("limits very long task names", () => {
    expect(safeTaskName("A".repeat(120))).toHaveLength(80);
  });

  it("keeps GeneDB-compatible output file names with optional full provenance", () => {
    expect(outputFileNames("Task")).toEqual([
      "Task_Aligned.fasta",
      "Task_excluded_ambiguous.fasta",
      "Task_meta.json",
      "Task_records.jsonl",
      "run_info.json",
      "process.log"
    ]);
    expect(outputFileNames("Task", false)).toEqual(["Task_Aligned.fasta", "Task_excluded_ambiguous.fasta", "Task_meta.json", "run_info.json", "process.log"]);
  });

  it("builds GeneDB FASTA output without deduplicating accession-level records", () => {
    const bundle = buildGeneDbOutputBundle(baseState(), parseResult(), outputContext());

    expect(bundle.summary).toMatchObject({
      savedCount: 2,
      ambiguousCount: 1,
      lengthDroppedCount: 2,
      keywordDroppedCount: 1,
      droppedCount: 4,
      minLength: 10,
      maxLength: 10
    });
    expect(bundle.alignedFasta).toContain(">Valid_hit_ACC001\nCCCCCCCCCC");
    expect(bundle.alignedFasta).toContain(">Valid_hit_ACC001_2\nCCCCCCCCCC");
    expect(bundle.alignedFasta.match(/CCCCCCCCCC/g)).toHaveLength(2);
    expect(bundle.ambiguousFasta).toContain(">Ambiguous_hit_ACCN\nCCCCNCCCCC");
  });

  it("splits summary meta.json from full provenance records.jsonl", () => {
    const bundle = buildGeneDbOutputBundle(baseState(), parseResult(), outputContext());
    const meta = JSON.parse(bundle.metaJson);
    const rows = recordsJsonlRows(bundle);

    expect(bundle.alignedFasta).toContain(">Valid_hit_ACC001");
    expect(bundle.alignedFasta).not.toContain("evalue");
    expect(meta.records).toBeUndefined();
    expect(meta.parserDropped).toBeUndefined();
    expect(meta.outputManifest).toMatchObject({
      metaMode: "summary_only",
      fullProvenance: {
        included: true,
        format: "jsonl",
        fileName: "Task_records.jsonl",
        recordCount: 6,
        parserDroppedCount: 1,
        sequenceIncluded: false
      }
    });
    expect(meta.recordSummary).toMatchObject({
      outputRecordCount: 6,
      parserDroppedCount: 1,
      fullProvenanceMovedTo: "Task_records.jsonl"
    });

    expect(findOutputRecord(rows, "ACC001")).toMatchObject({
      kind: "output_record",
      accession: "ACC001",
      title: "Valid hit",
      header: "Valid_hit_ACC001",
      disposition: "aligned",
      hitRange: [1, 10],
      queryRange: [2, 11],
      identity: 9,
      evalue: 0.001,
      bitScore: 50,
      sequenceIncluded: false
    });
    expect(findOutputRecord(rows, "ACC001").sequence).toBeUndefined();
    expect(rows.find((row) => row.kind === "parser_dropped")).toMatchObject({
      accession: "DROP001",
      title: "No sequence",
      disposition: "parser_dropped",
      dropReason: "No usable first HSP sequence",
      sequenceIncluded: false
    });
  });

  it("keeps partial XML diagnostics in summary meta, run_info, and process.log", () => {
    const bundle = buildGeneDbOutputBundle(baseState(), parseResult(), outputContext());
    const meta = JSON.parse(bundle.metaJson);
    const runInfo = JSON.parse(bundle.runInfoJson);

    expect(meta.resultSummary).toMatchObject({
      completeHitBlocksSeen: 6,
      partialXmlTail: true,
      completeness: {
        status: "partial_complete_hit_blocks",
        completeHitBlocksSeen: 6,
        partialXmlTail: true,
        partialTailPolicy: "complete_hit_blocks_only"
      }
    });
    expect(meta.parserDiagnostics).toMatchObject({
      completeHitBlocksSeen: 6,
      partialXmlTail: true
    });
    expect(runInfo.Result.completeness).toMatchObject({
      status: "partial_complete_hit_blocks",
      partialTailPolicy: "complete_hit_blocks_only"
    });
    expect(bundle.processLog).toContain("partialXmlTail=true");
    expect(bundle.processLog).toContain("Partial XML tail detected");
  });

  it("writes XML fallback success summary to meta.json, run_info.json, and process.log", () => {
    const fallback = {
      attempted: true,
      status: "fallback_succeeded" as const,
      primaryFormat: "JSON2_S" as const,
      fallbackFormat: "XML" as const,
      finalFormat: "XML" as const,
      primaryFailure: {
        format: "JSON2_S" as const,
        reason: "http_status" as const,
        code: "failed_ncbi" as const,
        message: "NCBI BLAST result download(JSON2_S) failed with HTTP 500."
      }
    };
    const bundle = buildGeneDbOutputBundle(baseState(), parseResult(), {
      ...outputContext(),
      resultFormat: "XML",
      resultFallback: fallback,
      processLogs: ["JSON2_S large download failed; XML fallback succeeded. primary=http_status/failed_ncbi"]
    });
    const meta = JSON.parse(bundle.metaJson);
    const runInfo = JSON.parse(bundle.runInfoJson);

    expect(meta.resultSummary).toMatchObject({
      format: "XML",
      fallback: {
        status: "fallback_succeeded",
        primaryFailure: {
          reason: "http_status",
          code: "failed_ncbi"
        }
      }
    });
    expect(runInfo.Result.fallback).toMatchObject({
      status: "fallback_succeeded",
      primaryFormat: "JSON2_S",
      fallbackFormat: "XML"
    });
    expect(bundle.processLog).toContain("Result fallback status=fallback_succeeded");
    expect(bundle.processLog).toContain("JSON2_S large download failed; XML fallback succeeded");
  });

  it("applies length before keyword before ambiguous N separation", () => {
    const bundle = buildGeneDbOutputBundle(baseState(), parseResult(), outputContext());
    const rows = recordsJsonlRows(bundle);

    expect(findOutputRecord(rows, "LOWLEN")).toMatchObject({ disposition: "length_dropped" });
    expect(findOutputRecord(rows, "HIGHLEN")).toMatchObject({ disposition: "length_dropped" });
    expect(findOutputRecord(rows, "KW001")).toMatchObject({ disposition: "keyword_dropped" });
    expect(findOutputRecord(rows, "ACCN")).toMatchObject({ disposition: "ambiguous" });
  });

  it("keeps N-containing records in aligned FASTA when ambiguous separation is disabled", () => {
    const bundle = buildGeneDbOutputBundle({ ...baseState(), excludeAmbiguousN: false }, parseResult(), outputContext());

    expect(bundle.summary.savedCount).toBe(3);
    expect(bundle.summary.ambiguousCount).toBe(0);
    expect(bundle.alignedFasta).toContain(">Ambiguous_hit_ACCN\nCCCCNCCCCC");
    expect(bundle.ambiguousFasta.trim()).toBe("");
  });

  it("treats U-normalized records as aligned, not ambiguous", () => {
    const normalized = normalizeParsedHspSequence("AUUGC");
    const parse = parseResultWithRecords([record("RNA001", "RNA-like hit", normalized.sequence, "hseq", normalized.normalization)]);
    const bundle = buildGeneDbOutputBundle({ ...baseState("AAAAA"), lengthFilterEnabled: false, keywordFilterEnabled: false }, parse, outputContext());

    expect(bundle.alignedFasta).toContain(">RNA-like_hit_RNA001\nATTGC");
    expect(bundle.alignedFasta).not.toContain("AUUGC");
    expect(bundle.ambiguousFasta.trim()).toBe("");
    expect(bundle.summary.ambiguousCount).toBe(0);
  });

  it("splits only N-containing ambiguous records while keeping other IUPAC ambiguity aligned", () => {
    const parse = parseResultWithRecords([
      record("ACCN", "N ambiguous hit", "CCCCNCCCCC"),
      record("ACCR", "Non-N IUPAC hit", "CCCCRCCCCC")
    ]);
    const bundle = buildGeneDbOutputBundle(baseState(), parse, outputContext());
    const meta = JSON.parse(bundle.metaJson);
    const rows = recordsJsonlRows(bundle);

    expect(findOutputRecord(rows, "ACCN")).toMatchObject({ disposition: "ambiguous" });
    expect(findOutputRecord(rows, "ACCR")).toMatchObject({ disposition: "aligned" });
    expect(bundle.alignedFasta).toContain(">Non-N_IUPAC_hit_ACCR\nCCCCRCCCCC");
    expect(bundle.ambiguousFasta).toContain(">N_ambiguous_hit_ACCN\nCCCCNCCCCC");
    expect(meta.resultSequenceNormalization).toMatchObject({
      otherIupacAmbiguityCount: 1,
      ambiguousPolicy: "n_only"
    });
  });

  it("writes result sequence normalization and qseq fallback summary without raw RNA HSP text", () => {
    const normalized = normalizeParsedHspSequence("AUUCC");
    const parse = parseResultWithRecords([record("QSEQ001", "qseq fallback RNA-like hit", normalized.sequence, "qseq", normalized.normalization)], [
      "Hsp_hseq was missing for 1 record(s); Hsp_qseq fallback was saved with sequenceSource=qseq."
    ]);
    const bundle = buildGeneDbOutputBundle({ ...baseState("AAAAA"), lengthFilterEnabled: false, keywordFilterEnabled: false }, parse, outputContext());
    const meta = JSON.parse(bundle.metaJson);
    const rows = recordsJsonlRows(bundle);
    const qseqRow = findOutputRecord(rows, "QSEQ001");
    const combinedSafeFiles = [bundle.metaJson, bundle.runInfoJson, bundle.processLog, bundle.recordsJsonl ?? "", bundle.alignedFasta, bundle.ambiguousFasta].join("\n");

    expect(meta.resultSummary.qseqFallbackCount).toBe(1);
    expect(meta.resultSequenceNormalization).toMatchObject({
      outputMode: "u_to_t",
      uToTCount: 2,
      qseqFallbackCount: 1,
      ambiguousPolicy: "n_only"
    });
    expect(qseqRow).toMatchObject({
      accession: "QSEQ001",
      sequenceSource: "qseq",
      recordWarnings: ["Hsp_hseq missing; Hsp_qseq fallback used."],
      sequenceIncluded: false
    });
    expect(qseqRow.sequence).toBeUndefined();
    expect(bundle.recordsJsonl).not.toContain("AUUCC");
    expect(bundle.recordsJsonl).not.toContain("ATTCC");
    expect(bundle.processLog).toContain("Result sequence normalization mode=U->T, uToT=2");
    expect(bundle.processLog).toContain("qseqFallback=1");
    expect(combinedSafeFiles).not.toContain("AUUCC");
  });

  it("can omit full provenance JSONL while keeping summary metadata", () => {
    const bundle = buildGeneDbOutputBundle({ ...baseState(), includeFullProvenance: false }, parseResult(), outputContext());
    const meta = JSON.parse(bundle.metaJson);
    const runInfo = JSON.parse(bundle.runInfoJson);

    expect(bundle.recordsJsonl).toBeNull();
    expect(bundle.fileNames).not.toContain("Task_records.jsonl");
    expect(meta.outputManifest.fullProvenance).toMatchObject({
      included: false,
      format: "jsonl",
      fileName: null,
      recordCount: 6,
      parserDroppedCount: 1,
      sequenceIncluded: false,
      omissionReason: "user_disabled"
    });
    expect(meta.recordSummary).toMatchObject({
      outputRecordCount: 6,
      parserDroppedCount: 1,
      fullProvenanceMovedTo: null,
      fullProvenanceOmissionReason: "user_disabled"
    });
    expect(runInfo.Options.full_provenance_records_jsonl).toBe(false);
    expect(runInfo.Options.full_provenance_omission_reason).toBe("user_disabled");
    expect(bundle.processLog).toContain("fullProvenance=omitted");
    expect(bundle.processLog).toContain("omissionReason=user_disabled");
  });

  it("marks full provenance omission caused by ZIP degradation", () => {
    const bundle = buildGeneDbOutputBundle({ ...baseState(), includeFullProvenance: false }, parseResult(), {
      ...outputContext(),
      fullProvenanceOmissionReason: "zip_degradation_after_primary_failure"
    });
    const meta = JSON.parse(bundle.metaJson);
    const runInfo = JSON.parse(bundle.runInfoJson);

    expect(bundle.recordsJsonl).toBeNull();
    expect(meta.outputManifest.fullProvenance).toMatchObject({
      included: false,
      fileName: null,
      omissionReason: "zip_degradation_after_primary_failure",
      sequenceIncluded: false
    });
    expect(meta.recordSummary.fullProvenanceOmissionReason).toBe("zip_degradation_after_primary_failure");
    expect(runInfo.Options.full_provenance_records_jsonl).toBe(false);
    expect(runInfo.Options.full_provenance_omission_reason).toBe("zip_degradation_after_primary_failure");
    expect(bundle.processLog).toContain("omissionReason=zip_degradation_after_primary_failure");
  });

  it("keeps summary meta size independent from record-level provenance volume", () => {
    const manyRecords = Array.from({ length: 200 }, (_, index) => record(`ACC${index}`, `Long synthetic title ${index} ${"x".repeat(200)}`, "CCCCCCCCCC"));
    const bundle = buildGeneDbOutputBundle({ ...baseState(), lengthFilterEnabled: false, keywordFilterEnabled: false }, parseResultWithRecords(manyRecords), outputContext());
    const meta = JSON.parse(bundle.metaJson);

    expect(meta.records).toBeUndefined();
    expect(meta.parserDropped).toBeUndefined();
    expect(meta.outputManifest.fullProvenance.recordCount).toBe(200);
    expect(bundle.recordsJsonl).not.toBeNull();
    expect(bundle.metaJson.length).toBeLessThan(20_000);
    expect(bundle.recordsJsonl!.length).toBeGreaterThan(bundle.metaJson.length);
  });

  it("does not put raw query sequence or raw result text into metadata, records JSONL, or process logs", () => {
    const state = baseState("AAAACCCCGGGGTTTT");
    const bundle = buildGeneDbOutputBundle(state, parseResult(), {
      ...outputContext(),
      processLogs: ["safe line", "accidental AAAACCCCGGGGTTTT raw query leak", "raw result marker should not contain downloaded text"]
    });
    const combinedSafeFiles = [bundle.metaJson, bundle.recordsJsonl ?? "", bundle.runInfoJson, bundle.processLog].join("\n");

    expect(combinedSafeFiles).not.toContain("AAAACCCCGGGGTTTT");
    expect(combinedSafeFiles).toContain("[redacted_query_sequence]");
    expect(combinedSafeFiles).not.toContain("RAW_BLAST_RESULT_TEXT");
  });

  it("redacts accidental logs containing NCBI-style formatted query text", () => {
    const formattedQuery = "1 AAAA CCCC\n61 GGGG TTTT";
    const bundle = buildGeneDbOutputBundle(baseState(formattedQuery), parseResult(), {
      ...outputContext(),
      processLogs: [`accidental formatted query ${formattedQuery}`]
    });

    expect(bundle.processLog).not.toContain(formattedQuery);
    expect(bundle.processLog).toContain("[redacted_query_sequence]");
  });
});

function baseState(referenceSequence = "AAAAAAAAAA"): CollectionFormState {
  return {
    taskName: "Task",
    referenceSequence,
    taxid: "10244",
    database: BLAST_DEFAULTS.database,
    task: BLAST_DEFAULTS.task,
    maxHits: BLAST_DEFAULTS.maxHits,
    expect: BLAST_DEFAULTS.expect,
    wordSize: BLAST_DEFAULTS.wordSize,
    tool: BLAST_DEFAULTS.tool,
    email: "",
    lengthFilterEnabled: true,
    minLengthPercent: FILTER_DEFAULTS.minLengthPercent,
    maxLengthPercent: FILTER_DEFAULTS.maxLengthPercent,
    keywordFilterEnabled: true,
    keywords: FILTER_DEFAULTS.keywords.join(", "),
    excludeAmbiguousN: true,
    includeFullProvenance: true
  };
}

function parseResult(): BlastParseResult {
  return {
    format: "JSON2_S",
    records: [
      record("ACC001", "Valid hit", "CCCCCCCCCC"),
      record("ACC001", "Valid hit", "CCCCCCCCCC"),
      record("ACCN", "Ambiguous hit", "CCCCNCCCCC"),
      record("LOWLEN", "Short hit", "CCCCCCCC"),
      record("HIGHLEN", "Long hit", "C".repeat(51)),
      record("KW001", "PREDICTED synthetic construct hit", "GGGGGGGGGG")
    ],
    dropped: [{ accession: "DROP001", title: "No sequence", reason: "No usable first HSP sequence" }],
    logs: ["Parsed synthetic output fixture"],
    summary: {
      savedCount: 6,
      droppedCount: 1,
      ambiguousCount: 0,
      uniqueCount: 5,
      lengthDroppedCount: 0,
      keywordDroppedCount: 0,
      minLength: 8,
      maxLength: 51
    },
    diagnostics: {
      completeHitBlocksSeen: 6,
      partialXmlTail: true,
      parserWarnings: ["synthetic partial XML warning"]
    }
  };
}

function record(
  accession: string,
  title: string,
  sequence: string,
  sequenceSource: ParsedHsp["sequenceSource"] = "hseq",
  sequenceNormalization = normalizeParsedHspSequence(sequence).normalization
) {
  return {
    accession,
    title,
    sequence,
    hspIndex: 0,
    sequenceSource,
    sequenceNormalization,
    hitRange: [1, sequence.length] as [number, number],
    queryRange: [2, sequence.length + 1] as [number, number],
    identity: Math.max(0, sequence.length - 1),
    evalue: 0.001,
    bitScore: 50
  };
}

function parseResultWithRecords(records: ParsedHsp[], parserWarnings: string[] = []): BlastParseResult {
  const result = parseResult();
  const normalization = records.reduce(
    (summary, item) => {
      const itemNormalization = item.sequenceNormalization ?? normalizeParsedHspSequence(item.sequence).normalization;
      summary.recordCount += 1;
      summary.uToTCount += itemNormalization.uToTCount;
      summary.nCount += itemNormalization.nCount;
      summary.otherIupacAmbiguityCount += itemNormalization.otherIupacAmbiguityCount;
      summary.invalidCharacterCount += itemNormalization.invalidCharacterCount;
      if (item.sequenceSource === "qseq") summary.qseqFallbackCount += 1;
      return summary;
    },
    {
      outputMode: "u_to_t" as const,
      recordCount: 0,
      uToTCount: 0,
      nCount: 0,
      otherIupacAmbiguityCount: 0,
      invalidCharacterCount: 0,
      qseqFallbackCount: 0,
      ambiguousPolicy: "n_only" as const
    }
  );

  return {
    ...result,
    records,
    dropped: [],
    diagnostics: {
      completeHitBlocksSeen: records.length,
      partialXmlTail: false,
      parserWarnings,
      qseqFallbackCount: normalization.qseqFallbackCount,
      resultSequenceNormalization: normalization
    }
  };
}

function outputContext() {
  return {
    rid: "RID123",
    resultFormat: "JSON2_S",
    resultDownloadedAt: Date.UTC(2026, 5, 14, 1, 2, 3),
    resultRawLength: 1234,
    processLogs: ["Submit started. query=fnv1a32:00000000, length=10 bp"]
  };
}

function recordsJsonlRows(bundle: GeneDbOutputBundle): Array<Record<string, any>> {
  expect(bundle.recordsJsonl).not.toBeNull();
  return bundle.recordsJsonl!
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function findOutputRecord(rows: Array<Record<string, any>>, accession: string): Record<string, any> {
  const item = rows.find((row) => row.kind === "output_record" && row.accession === accession);
  expect(item).toBeDefined();
  return item!;
}
