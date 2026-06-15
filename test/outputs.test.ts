import { describe, expect, it } from "vitest";
import { BLAST_DEFAULTS, FILTER_DEFAULTS } from "../src/config/defaults";
import type { BlastParseResult } from "../src/domain/blastResultParser";
import { buildGeneDbOutputBundle, outputFileNames, safeTaskName } from "../src/domain/outputs";
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

  it("keeps GeneDB-compatible output file names", () => {
    expect(outputFileNames("Task")).toEqual([
      "Task_Aligned.fasta",
      "Task_excluded_ambiguous.fasta",
      "Task_meta.json",
      "run_info.json",
      "process.log"
    ]);
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

  it("keeps provenance in meta.json and not in FASTA headers", () => {
    const bundle = buildGeneDbOutputBundle(baseState(), parseResult(), outputContext());
    const meta = JSON.parse(bundle.metaJson);

    expect(bundle.alignedFasta).toContain(">Valid_hit_ACC001");
    expect(bundle.alignedFasta).not.toContain("evalue");
    expect(meta.records[0]).toMatchObject({
      accession: "ACC001",
      title: "Valid hit",
      header: "Valid_hit_ACC001",
      disposition: "aligned",
      hitRange: [1, 10],
      queryRange: [2, 11],
      identity: 9,
      evalue: 0.001,
      bitScore: 50
    });
    expect(meta.parserDropped).toEqual([{ accession: "DROP001", title: "No sequence", reason: "No usable first HSP sequence" }]);
  });

  it("keeps partial XML diagnostics in meta.json and process.log", () => {
    const bundle = buildGeneDbOutputBundle(baseState(), parseResult(), outputContext());
    const meta = JSON.parse(bundle.metaJson);

    expect(meta.resultSummary).toMatchObject({
      completeHitBlocksSeen: 6,
      partialXmlTail: true
    });
    expect(meta.parserDiagnostics).toMatchObject({
      completeHitBlocksSeen: 6,
      partialXmlTail: true
    });
    expect(bundle.processLog).toContain("Partial XML tail detected. XML 끝부분이 불완전하여 수신된 결과 중 완성된 Hit block만 회수했습니다.");
  });

  it("applies length before keyword before ambiguous N separation", () => {
    const bundle = buildGeneDbOutputBundle(baseState(), parseResult(), outputContext());
    const meta = JSON.parse(bundle.metaJson);

    expect(meta.records.find((record: { accession: string }) => record.accession === "LOWLEN")).toMatchObject({
      disposition: "length_dropped"
    });
    expect(meta.records.find((record: { accession: string }) => record.accession === "HIGHLEN")).toMatchObject({
      disposition: "length_dropped"
    });
    expect(meta.records.find((record: { accession: string }) => record.accession === "KW001")).toMatchObject({
      disposition: "keyword_dropped"
    });
    expect(meta.records.find((record: { accession: string }) => record.accession === "ACCN")).toMatchObject({
      disposition: "ambiguous"
    });
  });

  it("keeps N-containing records in aligned FASTA when ambiguous separation is disabled", () => {
    const bundle = buildGeneDbOutputBundle({ ...baseState(), excludeAmbiguousN: false }, parseResult(), outputContext());

    expect(bundle.summary.savedCount).toBe(3);
    expect(bundle.summary.ambiguousCount).toBe(0);
    expect(bundle.alignedFasta).toContain(">Ambiguous_hit_ACCN\nCCCCNCCCCC");
    expect(bundle.ambiguousFasta.trim()).toBe("");
  });

  it("does not put raw query sequence or raw result text into metadata or process logs", () => {
    const state = baseState("AAAACCCCGGGGTTTT");
    const bundle = buildGeneDbOutputBundle(state, parseResult(), {
      ...outputContext(),
      processLogs: ["safe line", "accidental AAAACCCCGGGGTTTT raw query leak", "raw result marker should not contain downloaded text"]
    });
    const combinedSafeFiles = [bundle.metaJson, bundle.runInfoJson, bundle.processLog].join("\n");

    expect(combinedSafeFiles).not.toContain("AAAACCCCGGGGTTTT");
    expect(combinedSafeFiles).toContain("[redacted_query_sequence]");
    expect(combinedSafeFiles).not.toContain("RAW_BLAST_RESULT_TEXT");
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
    excludeAmbiguousN: true
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

function record(accession: string, title: string, sequence: string) {
  return {
    accession,
    title,
    sequence,
    hspIndex: 0,
    sequenceSource: "hseq" as const,
    hitRange: [1, sequence.length] as [number, number],
    queryRange: [2, sequence.length + 1] as [number, number],
    identity: Math.max(0, sequence.length - 1),
    evalue: 0.001,
    bitScore: 50
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
