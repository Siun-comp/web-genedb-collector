import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import type { GeneDbOutputBundle } from "../domain/outputs";
import { outputFileNames } from "../domain/outputs";

const TEXT_ENCODER = new TextEncoder();
const DEFAULT_ZIP_RISK_THRESHOLDS = {
  largeBytes: 25 * 1024 * 1024,
  veryLargeBytes: 100 * 1024 * 1024,
  largeProvenanceBytes: 20 * 1024 * 1024,
  veryLargeProvenanceBytes: 75 * 1024 * 1024
} as const;

export interface ZipManifest {
  taskName: string;
  files: string[];
}

export type ZipRiskLevel = "normal" | "large" | "very_large";
export type ZipCreationMode = "primary" | "provenance_omitted";

export interface ZipRiskThresholds {
  largeBytes: number;
  veryLargeBytes: number;
  largeProvenanceBytes: number;
  veryLargeProvenanceBytes: number;
}

export interface ZipFileSizeEstimate {
  name: string;
  bytes: number;
  included: boolean;
  role: "aligned_fasta" | "ambiguous_fasta" | "summary_meta" | "records_provenance" | "run_info" | "process_log";
}

export interface ZipSizeEstimate {
  totalUncompressedBytes: number;
  totalUncompressedMb: number;
  recordsJsonlBytes: number;
  recordsJsonlMb: number;
  largestFile: ZipFileSizeEstimate | null;
  riskLevel: ZipRiskLevel;
  omitProvenanceRecommended: boolean;
  warnings: string[];
  files: ZipFileSizeEstimate[];
}

export interface GeneDbZipCreationResult {
  blob: Blob;
  bundle: GeneDbOutputBundle;
  mode: ZipCreationMode;
  estimate: ZipSizeEstimate;
  primaryErrorMessage?: string;
  fallbackErrorMessage?: string;
  logs: string[];
}

export class GeneDbZipDegradationError extends Error {
  constructor(
    message: string,
    readonly primaryErrorMessage: string,
    readonly fallbackErrorMessage?: string
  ) {
    super(message);
    this.name = "GeneDbZipDegradationError";
  }
}

export function buildZipManifest(taskName: string, includeFullProvenance = true): ZipManifest {
  return {
    taskName,
    files: outputFileNames(taskName, includeFullProvenance)
  };
}

export function estimateGeneDbZipSize(bundle: GeneDbOutputBundle, thresholds: ZipRiskThresholds = DEFAULT_ZIP_RISK_THRESHOLDS): ZipSizeEstimate {
  const [alignedName, ambiguousName, metaName] = bundle.fileNames;
  const recordsName = bundle.fileNames.find((name) => name.endsWith("_records.jsonl"));
  const runInfoName = bundle.fileNames.find((name) => name === "run_info.json") ?? "run_info.json";
  const processLogName = bundle.fileNames.find((name) => name === "process.log") ?? "process.log";
  const files: ZipFileSizeEstimate[] = [
    fileEstimate(alignedName, bundle.alignedFasta, true, "aligned_fasta"),
    fileEstimate(ambiguousName, bundle.ambiguousFasta, true, "ambiguous_fasta"),
    fileEstimate(metaName, bundle.metaJson, true, "summary_meta"),
    ...(recordsName
      ? [fileEstimate(recordsName, bundle.recordsJsonl ?? "", bundle.recordsJsonl !== null, "records_provenance" as const)]
      : []),
    fileEstimate(runInfoName, bundle.runInfoJson, true, "run_info"),
    fileEstimate(processLogName, bundle.processLog, true, "process_log")
  ];
  const includedFiles = files.filter((file) => file.included);
  const totalUncompressedBytes = includedFiles.reduce((sum, file) => sum + file.bytes, 0);
  const recordsJsonlBytes = includedFiles.find((file) => file.role === "records_provenance")?.bytes ?? 0;
  const largestFile = includedFiles.reduce<ZipFileSizeEstimate | null>((largest, file) => (!largest || file.bytes > largest.bytes ? file : largest), null);
  const warnings: string[] = [];

  if (totalUncompressedBytes >= thresholds.veryLargeBytes) {
    warnings.push("Total ZIP input is very large; browser memory or download may fail.");
  } else if (totalUncompressedBytes >= thresholds.largeBytes) {
    warnings.push("Total ZIP input is large; download may take time and use substantial browser memory.");
  }
  if (recordsJsonlBytes >= thresholds.veryLargeProvenanceBytes) {
    warnings.push("records.jsonl is very large; omit full provenance if ZIP generation fails.");
  } else if (recordsJsonlBytes >= thresholds.largeProvenanceBytes) {
    warnings.push("records.jsonl is large; consider omitting full provenance for a more stable ZIP.");
  }

  const riskLevel: ZipRiskLevel =
    totalUncompressedBytes >= thresholds.veryLargeBytes || recordsJsonlBytes >= thresholds.veryLargeProvenanceBytes
      ? "very_large"
      : totalUncompressedBytes >= thresholds.largeBytes || recordsJsonlBytes >= thresholds.largeProvenanceBytes
        ? "large"
        : "normal";

  return {
    totalUncompressedBytes,
    totalUncompressedMb: bytesToMb(totalUncompressedBytes),
    recordsJsonlBytes,
    recordsJsonlMb: bytesToMb(recordsJsonlBytes),
    largestFile,
    riskLevel,
    omitProvenanceRecommended: recordsJsonlBytes >= thresholds.largeProvenanceBytes,
    warnings,
    files
  };
}

export async function createGeneDbZip(bundle: GeneDbOutputBundle): Promise<Blob> {
  const hasRecordsEntry = bundle.fileNames.some((name) => name.endsWith("_records.jsonl"));
  if (bundle.recordsJsonl !== null && !hasRecordsEntry) {
    throw new Error("ZIP bundle manifest is inconsistent: records.jsonl content is present but the file entry is missing.");
  }
  if (bundle.recordsJsonl === null && hasRecordsEntry) {
    throw new Error("ZIP bundle manifest is inconsistent: records.jsonl file entry is present but content is omitted.");
  }

  const [alignedName, ambiguousName, metaName] = bundle.fileNames;
  const recordsName = hasRecordsEntry ? bundle.fileNames.find((name) => name.endsWith("_records.jsonl")) : undefined;
  const runInfoName = bundle.fileNames.find((name) => name === "run_info.json");
  const processLogName = bundle.fileNames.find((name) => name === "process.log");
  if (!runInfoName || !processLogName) {
    throw new Error("ZIP manifest is missing run_info.json or process.log.");
  }

  const writer = new BlobWriter("application/zip");
  const zipWriter = new ZipWriter(writer);

  try {
    await zipWriter.add(alignedName, new TextReader(ensureTrailingNewline(bundle.alignedFasta)));
    await zipWriter.add(ambiguousName, new TextReader(ensureTrailingNewline(bundle.ambiguousFasta)));
    await zipWriter.add(metaName, new TextReader(ensureTrailingNewline(bundle.metaJson)));
    if (bundle.recordsJsonl !== null && recordsName) {
      await zipWriter.add(recordsName, new TextReader(ensureTrailingNewline(bundle.recordsJsonl)));
    }
    await zipWriter.add(runInfoName, new TextReader(ensureTrailingNewline(bundle.runInfoJson)));
    await zipWriter.add(processLogName, new TextReader(ensureTrailingNewline(bundle.processLog)));
  } finally {
    await zipWriter.close();
  }

  return writer.getData();
}

export async function createGeneDbZipWithDegradation(
  primaryBundle: GeneDbOutputBundle,
  fallbackBundle?: GeneDbOutputBundle,
  createZip: (bundle: GeneDbOutputBundle) => Promise<Blob> = createGeneDbZip
): Promise<GeneDbZipCreationResult> {
  const primaryEstimate = estimateGeneDbZipSize(primaryBundle);
  try {
    const blob = await createZip(primaryBundle);
    return {
      blob,
      bundle: primaryBundle,
      mode: "primary",
      estimate: primaryEstimate,
      logs: [`ZIP primary generated. uncompressedBytes=${primaryEstimate.totalUncompressedBytes}, risk=${primaryEstimate.riskLevel}`]
    };
  } catch (error) {
    const primaryErrorMessage = errorMessage(error);
    if (!fallbackBundle || primaryBundle.recordsJsonl === null) {
      throw new GeneDbZipDegradationError(`ZIP primary generation failed: ${primaryErrorMessage}`, primaryErrorMessage);
    }

    const degradedBundle = appendProcessLog(
      fallbackBundle,
      `ZIP degradation fallback used. primaryError=${primaryErrorMessage}; omitted=records.jsonl; mode=provenance_omitted`
    );
    try {
      const blob = await createZip(degradedBundle);
      const estimate = estimateGeneDbZipSize(degradedBundle);
      return {
        blob,
        bundle: degradedBundle,
        mode: "provenance_omitted",
        estimate,
        primaryErrorMessage,
        logs: [
          `ZIP primary failed. error=${primaryErrorMessage}`,
          `ZIP degradation succeeded. mode=provenance_omitted, omitted=records.jsonl, uncompressedBytes=${estimate.totalUncompressedBytes}, risk=${estimate.riskLevel}`
        ]
      };
    } catch (fallbackError) {
      const fallbackErrorMessage = errorMessage(fallbackError);
      throw new GeneDbZipDegradationError(
        `ZIP primary and provenance-omitted fallback both failed: primary=${primaryErrorMessage}; fallback=${fallbackErrorMessage}`,
        primaryErrorMessage,
        fallbackErrorMessage
      );
    }
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function fileEstimate(name: string, value: string, included: boolean, role: ZipFileSizeEstimate["role"]): ZipFileSizeEstimate {
  return {
    name,
    bytes: TEXT_ENCODER.encode(ensureTrailingNewline(value)).byteLength,
    included,
    role
  };
}

function bytesToMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function errorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? `${error.name ? `${error.name}: ` : ""}${error.message}` : String(error);
  return rawMessage
    .replace(/RAW_BLAST_RESULT_TEXT/gi, "[redacted_raw_result]")
    .replace(/\b[ACGTUNRYSWKMBDHV]{20,}\b/gi, "[redacted_sequence]");
}

function appendProcessLog(bundle: GeneDbOutputBundle, line: string): GeneDbOutputBundle {
  return {
    ...bundle,
    processLog: `${ensureTrailingNewline(bundle.processLog)}${new Date().toISOString()} ${line}\n`
  };
}
