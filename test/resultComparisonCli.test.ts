import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = join(process.cwd(), "scripts", "compare-result-sets.mjs");
let tempRoots: string[] = [];

describe("result comparison CLI", () => {
  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  it("compares ZIP and directory result sets without printing sequences or headers", async () => {
    const root = makeTempRoot();
    const webDir = join(root, "web");
    const sup12Dir = join(root, "sup12");
    mkdirSync(webDir);
    mkdirSync(sup12Dir);

    const webAligned = fasta([
      ["web_header_common", "AAAACCCCGGGG"],
      ["web_header_duplicate", "AAAACCCCGGGG"],
      ["web_header_only", "CCCCAAAATTTT"]
    ]);
    const webAmbiguous = fasta([["web_ambiguous_header", "NNNNAAAACCCC"]]);
    const sup12Aligned = fasta([
      ["sup12_header_common", "AAAACCCCGGGG"],
      ["sup12_header_only", "GGGGTTTTAAAA"]
    ]);
    const sup12Ambiguous = fasta([
      ["sup12_ambiguous_common", "NNNNAAAACCCC"],
      ["sup12_ambiguous_only", "NNNNTTTTCCCC"]
    ]);

    const webZip = join(root, "web.zip");
    await writeZip(webZip, {
      "Web_Aligned.fasta": webAligned,
      "Web_excluded_ambiguous.fasta": webAmbiguous
    });
    writeFileSync(join(sup12Dir, "SUP12_Aligned.fasta"), sup12Aligned);
    writeFileSync(join(sup12Dir, "SUP12_excluded_ambiguous.fasta"), sup12Ambiguous);

    const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--web", webZip, "--sup12", sup12Dir], { cwd: process.cwd() });
    const report = JSON.parse(stdout);

    expect(report.inputs.web.kind).toBe("zip");
    expect(report.inputs.sup12.kind).toBe("directory");
    expect(report.aligned).toMatchObject({
      webRecordCount: 3,
      sup12RecordCount: 2,
      webUniqueSequenceHashCount: 2,
      sup12UniqueSequenceHashCount: 2,
      commonUniqueSequenceHashCount: 1,
      webOnlyUniqueSequenceHashCount: 1,
      sup12OnlyUniqueSequenceHashCount: 1
    });
    expect(report.ambiguous).toMatchObject({
      webRecordCount: 1,
      sup12RecordCount: 2,
      webUniqueSequenceHashCount: 1,
      sup12UniqueSequenceHashCount: 2,
      commonUniqueSequenceHashCount: 1,
      webOnlyUniqueSequenceHashCount: 0,
      sup12OnlyUniqueSequenceHashCount: 1
    });
    expect(report.privacy).toMatchObject({
      rawSequencesPrinted: false,
      rawBlastResultsRead: false,
      fastaHeadersPrinted: false,
      individualHashesPrinted: false
    });
    expect(stdout).not.toContain("AAAACCCCGGGG");
    expect(stdout).not.toContain("web_header_common");
    expect(stdout).not.toContain("sup12_header_common");
  });

  it("treats missing ambiguous FASTA as zero records", async () => {
    const root = makeTempRoot();
    const webDir = join(root, "web");
    const sup12Dir = join(root, "sup12");
    mkdirSync(webDir);
    mkdirSync(sup12Dir);
    writeFileSync(join(webDir, "Web_Aligned.fasta"), fasta([["web", "AAAA"]]));
    writeFileSync(join(sup12Dir, "SUP12_Aligned.fasta"), fasta([["sup12", "AAAA"]]));

    const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--web", webDir, "--sup12", sup12Dir], { cwd: process.cwd() });
    const report = JSON.parse(stdout);

    expect(report.ambiguous.webRecordCount).toBe(0);
    expect(report.ambiguous.sup12RecordCount).toBe(0);
  });

  it("fails malformed FASTA with a safe message", async () => {
    const root = makeTempRoot();
    const webPath = join(root, "web.fasta");
    const sup12Path = join(root, "sup12.fasta");
    writeFileSync(webPath, "LEAKYSEQUENCEBEFOREHEADER\n>later\nAAAA\n");
    writeFileSync(sup12Path, fasta([["sup12_header", "AAAA"]]));

    await expect(execFileAsync(process.execPath, [scriptPath, "--web", webPath, "--sup12", sup12Path], { cwd: process.cwd() })).rejects.toMatchObject({
      stdout: "",
      stderr: expect.not.stringContaining("LEAKYSEQUENCEBEFOREHEADER")
    });
  });
});

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "web-genedb-compare-"));
  tempRoots.push(root);
  return root;
}

function fasta(records: Array<[string, string]>): string {
  return records.map(([header, sequence]) => `>${header}\n${sequence}\n`).join("");
}

async function writeZip(path: string, entries: Record<string, string>): Promise<void> {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [name, text] of Object.entries(entries)) {
    await writer.add(name, new TextReader(text));
  }
  const blob = await writer.close();
  writeFileSync(path, Buffer.from(await blob.arrayBuffer()));
}
