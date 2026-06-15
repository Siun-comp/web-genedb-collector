export type BlastTask = "megablast" | "blastn" | "dc-megablast";

export interface BlastDefaults {
  database: string;
  task: BlastTask;
  maxHits: number;
  maxHitsLimit: number;
  expect: number;
  wordSize: number;
  tool: string;
  email: string;
}

export interface FilterDefaults {
  lengthFilterEnabled: boolean;
  minLengthPercent: number;
  maxLengthPercent: number;
  keywordFilterEnabled: boolean;
  keywords: string[];
  excludeAmbiguousN: boolean;
}

export interface SequenceSummary {
  rawLength: number;
  cleanedLength: number;
  nCount: number;
  ambiguousIupacCount: number;
  gcPercent: number | null;
  uCount: number;
  invalidCharacters: string[];
  looksProteinLike: boolean;
  fasta: string;
}

export interface CollectionFormState {
  taskName: string;
  referenceSequence: string;
  taxid: string;
  database: string;
  task: BlastTask;
  maxHits: number;
  expect: number;
  wordSize: number;
  tool: string;
  email: string;
  lengthFilterEnabled: boolean;
  minLengthPercent: number;
  maxLengthPercent: number;
  keywordFilterEnabled: boolean;
  keywords: string;
  excludeAmbiguousN: boolean;
  includeFullProvenance?: boolean;
}

export type JobStatus =
  | "idle"
  | "blocked_invalid_input"
  | "ready_to_submit"
  | "submitting_disabled_mock"
  | "submitting"
  | "waiting"
  | "ready"
  | "no_hits"
  | "downloading"
  | "parsing"
  | "generatingZip"
  | "done"
  | "failed_network"
  | "failed_cors"
  | "failed_ncbi"
  | "failed_unknown_rid"
  | "failed_timeout"
  | "failed_parse"
  | "failed_zip";

export interface JobSnapshot {
  id: string;
  status: JobStatus;
  rid?: string;
  rtoeSeconds?: number;
  createdAt: string;
  updatedAt: string;
  state: CollectionFormState;
  logs: string[];
}

export interface ParserSummary {
  savedCount: number;
  droppedCount: number;
  ambiguousCount: number;
  uniqueCount: number;
  lengthDroppedCount: number;
  keywordDroppedCount: number;
  minLength: number;
  maxLength: number;
}

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationMessage {
  field: string;
  severity: ValidationSeverity;
  message: string;
  action: string;
}

export interface ValidationResult {
  canSubmit: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  infos: ValidationMessage[];
  messages: ValidationMessage[];
  sequenceSummary: SequenceSummary;
  entrezQuery: string;
}

export interface CollectionStatus {
  status: JobStatus;
  title: string;
  detail: string;
  nextAction: string;
}
