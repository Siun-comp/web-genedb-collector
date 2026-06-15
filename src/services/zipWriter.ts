import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import type { GeneDbOutputBundle } from "../domain/outputs";
import { outputFileNames } from "../domain/outputs";

export interface ZipManifest {
  taskName: string;
  files: string[];
}

export function buildZipManifest(taskName: string, includeFullProvenance = true): ZipManifest {
  return {
    taskName,
    files: outputFileNames(taskName, includeFullProvenance)
  };
}

export async function createGeneDbZip(bundle: GeneDbOutputBundle): Promise<Blob> {
  const writer = new BlobWriter("application/zip");
  const zipWriter = new ZipWriter(writer);
  const [alignedName, ambiguousName, metaName] = bundle.fileNames;
  const recordsName = bundle.recordsJsonl !== null ? bundle.fileNames.find((name) => name.endsWith("_records.jsonl")) : undefined;
  const runInfoName = bundle.fileNames.find((name) => name === "run_info.json");
  const processLogName = bundle.fileNames.find((name) => name === "process.log");
  if (!runInfoName || !processLogName) {
    throw new Error("ZIP manifest is missing run_info.json or process.log.");
  }

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
