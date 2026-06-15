import { BLAST_DEFAULTS, FILTER_DEFAULTS } from "../config/defaults";
import { parseKeywords } from "./filters";
import type { CollectionFormState } from "./types";

export const SUP12_COMPATIBILITY_PRESET = {
  id: "sup12-compatibility",
  label: "SUP12 compatibility",
  description: "Use SUP12-like comparison settings: maxHits 50000, length 80-500%, same keyword and ambiguous-N handling.",
  values: {
    database: "core_nt",
    task: "megablast",
    maxHits: 50000,
    expect: 0.05,
    wordSize: 11,
    lengthFilterEnabled: true,
    minLengthPercent: 80,
    maxLengthPercent: 500,
    keywordFilterEnabled: true,
    keywords: FILTER_DEFAULTS.keywords,
    excludeAmbiguousN: true
  }
} as const;

export function applySup12CompatibilityPreset(state: CollectionFormState): CollectionFormState {
  return {
    ...state,
    database: SUP12_COMPATIBILITY_PRESET.values.database,
    task: SUP12_COMPATIBILITY_PRESET.values.task,
    maxHits: SUP12_COMPATIBILITY_PRESET.values.maxHits,
    expect: SUP12_COMPATIBILITY_PRESET.values.expect,
    wordSize: SUP12_COMPATIBILITY_PRESET.values.wordSize,
    lengthFilterEnabled: SUP12_COMPATIBILITY_PRESET.values.lengthFilterEnabled,
    minLengthPercent: SUP12_COMPATIBILITY_PRESET.values.minLengthPercent,
    maxLengthPercent: SUP12_COMPATIBILITY_PRESET.values.maxLengthPercent,
    keywordFilterEnabled: SUP12_COMPATIBILITY_PRESET.values.keywordFilterEnabled,
    keywords: SUP12_COMPATIBILITY_PRESET.values.keywords.join(", "),
    excludeAmbiguousN: SUP12_COMPATIBILITY_PRESET.values.excludeAmbiguousN
  };
}

export function isSup12CompatibilityPresetActive(state: CollectionFormState): boolean {
  const expectedKeywords = normalizeKeywords(SUP12_COMPATIBILITY_PRESET.values.keywords);
  const actualKeywords = normalizeKeywords(parseKeywords(state.keywords));

  return (
    state.database === SUP12_COMPATIBILITY_PRESET.values.database &&
    state.task === SUP12_COMPATIBILITY_PRESET.values.task &&
    state.maxHits === SUP12_COMPATIBILITY_PRESET.values.maxHits &&
    state.expect === SUP12_COMPATIBILITY_PRESET.values.expect &&
    state.wordSize === SUP12_COMPATIBILITY_PRESET.values.wordSize &&
    state.lengthFilterEnabled === SUP12_COMPATIBILITY_PRESET.values.lengthFilterEnabled &&
    state.minLengthPercent === SUP12_COMPATIBILITY_PRESET.values.minLengthPercent &&
    state.maxLengthPercent === SUP12_COMPATIBILITY_PRESET.values.maxLengthPercent &&
    state.keywordFilterEnabled === SUP12_COMPATIBILITY_PRESET.values.keywordFilterEnabled &&
    state.excludeAmbiguousN === SUP12_COMPATIBILITY_PRESET.values.excludeAmbiguousN &&
    arraysEqual(actualKeywords, expectedKeywords)
  );
}

export function isDefaultCollectionPresetActive(state: CollectionFormState): boolean {
  return (
    state.database === BLAST_DEFAULTS.database &&
    state.task === BLAST_DEFAULTS.task &&
    state.maxHits === BLAST_DEFAULTS.maxHits &&
    state.expect === BLAST_DEFAULTS.expect &&
    state.wordSize === BLAST_DEFAULTS.wordSize &&
    state.lengthFilterEnabled === FILTER_DEFAULTS.lengthFilterEnabled &&
    state.minLengthPercent === FILTER_DEFAULTS.minLengthPercent &&
    state.maxLengthPercent === FILTER_DEFAULTS.maxLengthPercent &&
    state.keywordFilterEnabled === FILTER_DEFAULTS.keywordFilterEnabled &&
    state.excludeAmbiguousN === FILTER_DEFAULTS.excludeAmbiguousN &&
    arraysEqual(normalizeKeywords(parseKeywords(state.keywords)), normalizeKeywords(FILTER_DEFAULTS.keywords))
  );
}

function normalizeKeywords(keywords: readonly string[]): string[] {
  return keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean).sort();
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
