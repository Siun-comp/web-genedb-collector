import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { createGeneDbZip } from "../src/services/zipWriter";
import type { GeneDbOutputBundle } from "../src/domain/outputs";

describe("zip writer", () => {
  it("creates a GeneDB-compatible ZIP with exact output filenames", async () => {
    const zip = await createGeneDbZip(bundle());
    const reader = new ZipReader(new BlobReader(zip));
    const entries = await reader.getEntries();
    const names = entries.map((entry) => entry.filename);

    expect(names).toEqual(["Task_Aligned.fasta", "Task_excluded_ambiguous.fasta", "Task_meta.json", "run_info.json", "process.log"]);
    expect(await readEntry(entries, "Task_Aligned.fasta")).toContain(">Synthetic_hit_SYN001");
    expect(await readEntry(entries, "process.log")).not.toContain("AAAACCCCGGGGTTTT");
    await reader.close();
  });
});

async function readEntry(entries: Awaited<ReturnType<ZipReader<Blob>["getEntries"]>>, fileName: string): Promise<string> {
  const entry = entries.find((candidate) => candidate.filename === fileName);
  if (!entry || !("getData" in entry)) {
    throw new Error(`Missing ZIP file entry: ${fileName}`);
  }
  return entry.getData(new TextWriter());
}

function bundle(): GeneDbOutputBundle {
  return {
    fileNames: ["Task_Aligned.fasta", "Task_excluded_ambiguous.fasta", "Task_meta.json", "run_info.json", "process.log"],
    alignedFasta: ">Synthetic_hit_SYN001\nCCCCCCCCCC\n",
    ambiguousFasta: "",
    metaJson: JSON.stringify({ taskId: "Task", queryLength: 16 }),
    runInfoJson: JSON.stringify({ TaskID: "Task" }),
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
