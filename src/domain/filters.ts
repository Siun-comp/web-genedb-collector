import { FILTER_DEFAULTS } from "../config/defaults";
import type { FilterDefaults } from "./types";

export function defaultFilterState(): FilterDefaults {
  return {
    ...FILTER_DEFAULTS,
    keywords: [...FILTER_DEFAULTS.keywords]
  };
}

export function parseKeywords(value: string): string[] {
  return value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

