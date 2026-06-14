import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import type { GeneDbOutputBundle } from "../domain/outputs";
import { outputFileNames } from "../domain/outputs";

export interface ZipManifest {
  taskName: string;
  files: string[];
}

export function buildZipManifest(taskName: string): ZipManifest {
  return {
    taskName,
    files: outputFileNames(taskName)
  };
}

export async function createGeneDbZip(bundle: GeneDbOutputBundle): Promise<Blob> {
  const writer = new BlobWriter("application/zip");
  const zipWriter = new ZipWriter(writer);
  const [alignedName, ambiguousName, metaName, runInfoName, processLogName] = bundle.fileNames;

  try {
    await zipWriter.add(alignedName, new TextReader(ensureTrailingNewline(bundle.alignedFasta)));
    await zipWriter.add(ambiguousName, new TextReader(ensureTrailingNewline(bundle.ambiguousFasta)));
    await zipWriter.add(metaName, new TextReader(ensureTrailingNewline(bundle.metaJson)));
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
