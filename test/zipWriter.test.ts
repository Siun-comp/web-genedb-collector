import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { GeneDbZipDegradationError, createGeneDbZip, createGeneDbZipWithDegradation, estimateGeneDbZipSize } from "../src/services/zipWriter";
import type { GeneDbOutputBundle } from "../src/domain/outputs";

describe("zip writer", () => {
  it("creates a GeneDB-compatible ZIP with full provenance JSONL by default", async () => {
    const zip = await createGeneDbZip(bundle());
    const reader = new ZipReader(new BlobReader(zip));
    const entries = await reader.getEntries();
    const names = entries.map((entry) => entry.filename);

    expect(names).toEqual(["Task_Aligned.fasta", "Task_excluded_ambiguous.fasta", "Task_meta.json", "Task_records.jsonl", "run_info.json", "process.log"]);
    expect(await readEntry(entries, "Task_Aligned.fasta")).toContain(">Synthetic_hit_SYN001");
    expect(await readEntry(entries, "Task_records.jsonl")).toContain('"accession":"SYN001"');
    expect(await readEntry(entries, "Task_records.jsonl")).not.toContain("AAAACCCCGGGGTTTT");
    expect(await readEntry(entries, "process.log")).not.toContain("AAAACCCCGGGGTTTT");
    await reader.close();
  });

  it("omits records.jsonl when full provenance is disabled", async () => {
    const zip = await createGeneDbZip(bundle(false));
    const reader = new ZipReader(new BlobReader(zip));
    const entries = await reader.getEntries();
    const names = entries.map((entry) => entry.filename);

    expect(names).toEqual(["Task_Aligned.fasta", "Task_excluded_ambiguous.fasta", "Task_meta.json", "run_info.json", "process.log"]);
    expect(names).not.toContain("Task_records.jsonl");
    await reader.close();
  });

  it("estimates ZIP source bytes and warns when provenance is large", () => {
    const estimate = estimateGeneDbZipSize(bundle(), {
      largeBytes: 1,
      veryLargeBytes: 1_000_000,
      largeProvenanceBytes: 1,
      veryLargeProvenanceBytes: 1_000_000
    });

    expect(estimate.totalUncompressedBytes).toBeGreaterThan(0);
    expect(estimate.recordsJsonlBytes).toBeGreaterThan(0);
    expect(estimate.riskLevel).toBe("large");
    expect(estimate.omitProvenanceRecommended).toBe(true);
    expect(estimate.files.map((file) => file.role)).toEqual(["aligned_fasta", "ambiguous_fasta", "summary_meta", "records_provenance", "run_info", "process_log"]);
    expect(JSON.stringify(estimate)).not.toContain("AAAACCCCGGGGTTTT");
  });

  it("rejects inconsistent provenance manifest instead of silently omitting records.jsonl", async () => {
    const inconsistent = {
      ...bundle(),
      fileNames: ["Task_Aligned.fasta", "Task_excluded_ambiguous.fasta", "Task_meta.json", "run_info.json", "process.log"]
    } as GeneDbOutputBundle;

    await expect(createGeneDbZip(inconsistent)).rejects.toThrow("records.jsonl content is present");
  });

  it("falls back to provenance-omitted ZIP after primary full ZIP write failure", async () => {
    let attempts = 0;
    const result = await createGeneDbZipWithDegradation(bundle(), bundle(false, "zip_degradation_after_primary_failure"), async (candidate) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Quota failed AAAACCCCGGGGTTTTAAAACCCC RAW_BLAST_RESULT_TEXT");
      }
      return createGeneDbZip(candidate);
    });
    const reader = new ZipReader(new BlobReader(result.blob));
    const entries = await reader.getEntries();
    const names = entries.map((entry) => entry.filename);

    expect(attempts).toBe(2);
    expect(result.mode).toBe("provenance_omitted");
    expect(result.primaryErrorMessage).toContain("[redacted_sequence]");
    expect(result.primaryErrorMessage).toContain("[redacted_raw_result]");
    expect(result.primaryErrorMessage).not.toContain("AAAACCCCGGGGTTTT");
    expect(names).not.toContain("Task_records.jsonl");
    expect(JSON.parse(await readEntry(entries, "Task_meta.json")).outputManifest.fullProvenance).toMatchObject({
      included: false,
      omissionReason: "zip_degradation_after_primary_failure",
      sequenceIncluded: false
    });
    expect(JSON.parse(await readEntry(entries, "run_info.json")).Options.full_provenance_omission_reason).toBe("zip_degradation_after_primary_failure");
    expect(await readEntry(entries, "process.log")).toContain("ZIP degradation fallback used");
    await reader.close();
  });

  it("preserves primary and fallback ZIP failure messages when both attempts fail", async () => {
    try {
      await createGeneDbZipWithDegradation(bundle(), bundle(false), async () => {
        throw new Error("Quota failed AAAACCCCGGGGTTTTAAAACCCC RAW_BLAST_RESULT_TEXT");
      });
      throw new Error("Expected ZIP degradation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(GeneDbZipDegradationError);
      expect(error).toMatchObject({
        primaryErrorMessage: expect.stringContaining("[redacted_sequence]"),
        fallbackErrorMessage: expect.stringContaining("[redacted_raw_result]")
      });
      expect(JSON.stringify(error)).not.toContain("AAAACCCCGGGGTTTT");
    }
  });
});

async function readEntry(entries: Awaited<ReturnType<ZipReader<Blob>["getEntries"]>>, fileName: string): Promise<string> {
  const entry = entries.find((candidate) => candidate.filename === fileName);
  if (!entry || !("getData" in entry)) {
    throw new Error(`Missing ZIP file entry: ${fileName}`);
  }
  return entry.getData(new TextWriter());
}

function bundle(includeFullProvenance = true, omissionReason: string | null = includeFullProvenance ? null : "user_disabled"): GeneDbOutputBundle {
  return {
    fileNames: includeFullProvenance
      ? ["Task_Aligned.fasta", "Task_excluded_ambiguous.fasta", "Task_meta.json", "Task_records.jsonl", "run_info.json", "process.log"]
      : ["Task_Aligned.fasta", "Task_excluded_ambiguous.fasta", "Task_meta.json", "run_info.json", "process.log"],
    alignedFasta: ">Synthetic_hit_SYN001\nCCCCCCCCCC\n",
    ambiguousFasta: "",
    metaJson: JSON.stringify({
      taskId: "Task",
      queryLength: 16,
      outputManifest: {
        fullProvenance: {
          included: includeFullProvenance,
          format: "jsonl",
          fileName: includeFullProvenance ? "Task_records.jsonl" : null,
          recordCount: 1,
          parserDroppedCount: 0,
          sequenceIncluded: false,
          omissionReason
        }
      }
    }),
    recordsJsonl: includeFullProvenance
      ? JSON.stringify({
          kind: "output_record",
          accession: "SYN001",
          title: "Synthetic hit",
          sequenceIncluded: false
        })
      : null,
    runInfoJson: JSON.stringify({
      TaskID: "Task",
      Options: {
        full_provenance_records_jsonl: includeFullProvenance,
        full_provenance_omission_reason: omissionReason
      }
    }),
    processLog: "Query hash=fnv1a32:00000000\n",
    summary: {
      savedCount: 1,
      droppedCount: 0,
      ambiguousCount: 0,
      uniqueCount: 1,
      lengthDroppedCount: 0,
      keywordDroppedCount: 0,
      minLength: 10,
      maxLength: 10
    },
    records: [],
    parserDroppedCount: 0
  };
}
