import { describe, expect, it } from "vitest";
import { BLAST_DEFAULTS, FILTER_DEFAULTS } from "../src/config/defaults";
import { applySup12CompatibilityPreset, isDefaultCollectionPresetActive, isSup12CompatibilityPresetActive } from "../src/domain/collectionPresets";
import type { CollectionFormState } from "../src/domain/types";

describe("collection presets", () => {
  it("applies SUP12-compatible comparison settings without changing target fields", () => {
    const state = baseState();
    const applied = applySup12CompatibilityPreset(state);

    expect(applied.taskName).toBe(state.taskName);
    expect(applied.referenceSequence).toBe(state.referenceSequence);
    expect(applied.taxid).toBe(state.taxid);
    expect(applied).toMatchObject({
      database: "core_nt",
      task: "megablast",
      maxHits: 50000,
      expect: 0.05,
      wordSize: 11,
      lengthFilterEnabled: true,
      minLengthPercent: 80,
      maxLengthPercent: 500,
      keywordFilterEnabled: true,
      keywords: "synthetic, construct, predicted, unverified",
      excludeAmbiguousN: true
    });
  });

  it("detects active SUP12 preset even when keyword casing differs", () => {
    const applied = applySup12CompatibilityPreset(baseState());

    expect(isSup12CompatibilityPresetActive({ ...applied, keywords: "UNVERIFIED, predicted, Synthetic, construct" })).toBe(true);
    expect(isSup12CompatibilityPresetActive({ ...applied, maxHits: 100000 })).toBe(false);
  });

  it("detects the default collection preset separately", () => {
    expect(isDefaultCollectionPresetActive(baseState())).toBe(true);
    expect(isDefaultCollectionPresetActive(applySup12CompatibilityPreset(baseState()))).toBe(false);
  });
});

function baseState(): CollectionFormState {
  return {
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
}
