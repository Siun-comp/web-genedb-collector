import { describe, expect, it } from "vitest";
import { BLAST_DEFAULTS, FILTER_DEFAULTS } from "../src/config/defaults";
import type { CollectionFormState } from "../src/domain/types";
import { validateCollectionForm } from "../src/domain/validation";
import { buildCollectionStatus } from "../src/domain/status";

const validState: CollectionFormState = {
  taskName: "Task",
  referenceSequence: "ATGCGTACGTAGCTAGCTAG",
  taxid: "10244",
  database: BLAST_DEFAULTS.database,
  task: BLAST_DEFAULTS.task,
  maxHits: BLAST_DEFAULTS.maxHits,
  expect: BLAST_DEFAULTS.expect,
  wordSize: BLAST_DEFAULTS.wordSize,
  tool: BLAST_DEFAULTS.tool,
  email: "",
  lengthFilterEnabled: FILTER_DEFAULTS.lengthFilterEnabled,
  minLengthPercent: FILTER_DEFAULTS.minLengthPercent,
  maxLengthPercent: FILTER_DEFAULTS.maxLengthPercent,
  keywordFilterEnabled: FILTER_DEFAULTS.keywordFilterEnabled,
  keywords: FILTER_DEFAULTS.keywords.join(", "),
  excludeAmbiguousN: FILTER_DEFAULTS.excludeAmbiguousN
};

describe("collection form validation", () => {
  it("allows a valid default-like state", () => {
    const result = validateCollectionForm(validState);
    expect(result.canSubmit).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.entrezQuery).toBe("(txid10244[ORGN])");
  });

  it("blocks empty sequence and FASTA header-only input", () => {
    expect(validateCollectionForm({ ...validState, referenceSequence: "" }).canSubmit).toBe(false);
    expect(validateCollectionForm({ ...validState, referenceSequence: ">header only" }).errors[0].field).toBe("referenceSequence");
  });

  it("blocks invalid DNA characters", () => {
    const result = validateCollectionForm({ ...validState, referenceSequence: "ATGCXYZ" });
    expect(result.canSubmit).toBe(false);
    expect(result.errors.some((message) => message.message.includes("X"))).toBe(true);
  });

  it("blocks sequence shorter than word size", () => {
    const result = validateCollectionForm({ ...validState, referenceSequence: "ATGC", wordSize: 11 });
    expect(result.canSubmit).toBe(false);
    expect(result.errors.some((message) => message.field === "wordSize")).toBe(true);
  });

  it("validates NCBI-style numbered and spaced DNA using the cleaned length", () => {
    const result = validateCollectionForm({
      ...validState,
      referenceSequence: `1 atgc gtac
61 gcta gcta`,
      wordSize: 11
    });

    expect(result.canSubmit).toBe(true);
    expect(result.sequenceSummary.cleanedLength).toBe(16);
    expect(result.errors.some((message) => message.field === "wordSize")).toBe(false);
  });

  it("accepts RNA input and reports U to T conversion as information", () => {
    const result = validateCollectionForm({ ...validState, referenceSequence: "augcuunnaugcuunn" });

    expect(result.canSubmit).toBe(true);
    expect(result.sequenceSummary.cleanedLength).toBe(16);
    expect(result.sequenceSummary.uCount).toBe(6);
    expect(result.infos.some((message) => message.message.includes("RNA"))).toBe(true);
  });

  it("accepts full GenBank ORIGIN records without treating labels as sequence", () => {
    const result = validateCollectionForm({
      ...validState,
      referenceSequence: `LOCUS       SYNTHETIC        20 bp    DNA
DEFINITION  Synthetic minimized record.
FEATURES             Location/Qualifiers
ORIGIN
        1 atgc gtac
       61 gcta gcta
//
`
    });

    expect(result.canSubmit).toBe(true);
    expect(result.sequenceSummary.cleanedLength).toBe(16);
    expect(result.sequenceSummary.invalidCharacters).toEqual([]);
  });

  it("warns when sequence looks protein-like", () => {
    const result = validateCollectionForm({ ...validState, referenceSequence: "ATGCCCEEEEQQQPPP" });
    expect(result.warnings.some((message) => message.field === "referenceSequence")).toBe(true);
  });

  it("blocks nonnumeric taxid", () => {
    const result = validateCollectionForm({ ...validState, taxid: "Monkeypox" });
    expect(result.canSubmit).toBe(false);
    expect(result.errors.some((message) => message.field === "taxid")).toBe(true);
  });

  it("warns above 20000 max hits and blocks above 100000", () => {
    expect(validateCollectionForm({ ...validState, maxHits: 20000 }).warnings.some((message) => message.field === "maxHits")).toBe(false);
    expect(validateCollectionForm({ ...validState, maxHits: 20001 }).warnings.some((message) => message.field === "maxHits")).toBe(true);
    expect(validateCollectionForm({ ...validState, maxHits: 50000 }).canSubmit).toBe(true);
    expect(validateCollectionForm({ ...validState, maxHits: 50000 }).warnings.some((message) => message.field === "maxHits")).toBe(true);
    expect(validateCollectionForm({ ...validState, maxHits: 90000 }).warnings.some((message) => message.field === "maxHits")).toBe(true);
    expect(validateCollectionForm({ ...validState, maxHits: 100000 }).canSubmit).toBe(true);
    expect(validateCollectionForm({ ...validState, maxHits: 100001 }).canSubmit).toBe(false);
    expect(validateCollectionForm({ ...validState, maxHits: Number.NaN }).canSubmit).toBe(false);
  });

  it("blocks invalid expect and word size values", () => {
    expect(validateCollectionForm({ ...validState, expect: 0 }).canSubmit).toBe(false);
    expect(validateCollectionForm({ ...validState, wordSize: 0 }).canSubmit).toBe(false);
  });

  it("blocks reversed length filter range", () => {
    const result = validateCollectionForm({ ...validState, minLengthPercent: 500, maxLengthPercent: 90 });
    expect(result.canSubmit).toBe(false);
    expect(result.errors.some((message) => message.field === "lengthFilter")).toBe(true);
  });

  it("warns when keyword filter is enabled but empty", () => {
    const result = validateCollectionForm({ ...validState, keywords: "  " });
    expect(result.canSubmit).toBe(true);
    expect(result.warnings.some((message) => message.field === "keywords")).toBe(true);
  });

  it("maps validation result to status display", () => {
    expect(buildCollectionStatus(validateCollectionForm({ ...validState, taxid: "" })).status).toBe("blocked_invalid_input");
    expect(buildCollectionStatus(validateCollectionForm(validState)).status).toBe("ready_to_submit");
  });
});
