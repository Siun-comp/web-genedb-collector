import type { BlastDefaults, FilterDefaults } from "../domain/types";

export const APP_NAME = "Web GeneDB Collector";
export const APP_VERSION = "0.1.0";

export const BLAST_DEFAULTS: BlastDefaults = {
  database: "core_nt",
  task: "megablast",
  maxHits: 20000,
  maxHitsLimit: 100000,
  expect: 0.05,
  wordSize: 11,
  tool: "WebGeneDBCollector",
  email: ""
};

export const FILTER_DEFAULTS: FilterDefaults = {
  lengthFilterEnabled: true,
  minLengthPercent: 90,
  maxLengthPercent: 500,
  keywordFilterEnabled: true,
  keywords: ["synthetic", "construct", "predicted", "unverified"],
  excludeAmbiguousN: true
};

export const NCBI_BLAST_URL = "https://blast.ncbi.nlm.nih.gov/Blast.cgi";

