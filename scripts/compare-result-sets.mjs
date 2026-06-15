#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown comparison error";
  console.error(JSON.stringify({ error: message, privacy: privacySummary() }, null, 2));
  process.exitCode = 1;
});

async function main() {
  if (args.help || !args.web || !args.sup12) {
    printUsage();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const web = await loadResultSet(args.web, {
    alignedOverride: args["web-aligned"],
    ambiguousOverride: args["web-ambiguous"]
  });
  const sup12 = await loadResultSet(args.sup12, {
    alignedOverride: args["sup12-aligned"],
    ambiguousOverride: args["sup12-ambiguous"]
  });

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      web: inputSummary(args.web, web.kind),
      sup12: inputSummary(args.sup12, sup12.kind)
    },
    aligned: compareCategory(web.aligned, sup12.aligned),
    ambiguous: compareCategory(web.ambiguous, sup12.ambiguous),
    privacy: privacySummary()
  };

  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage:
  npm run compare:results -- --web "<web zip|dir|fasta>" --sup12 "<sup12 zip|dir|fasta>"

Optional paired FASTA inputs:
  --web-aligned "<fasta>" --web-ambiguous "<fasta>"
  --sup12-aligned "<fasta>" --sup12-ambiguous "<fasta>"

The output contains only counts and set-overlap summaries. It does not print FASTA headers, raw sequences, raw BLAST results, or individual hashes.`);
}

async function loadResultSet(inputPath, options = {}) {
  const resolved = resolve(inputPath);
  if (!existsSync(resolved)) {
    throw new Error(`Input path not found: ${inputPath}`);
  }

  if (options.alignedOverride) {
    return {
      kind: "paired-fasta",
      aligned: parseFastaText(readSafeText(options.alignedOverride), `${inputPath}:aligned`),
      ambiguous: options.ambiguousOverride ? parseFastaText(readSafeText(options.ambiguousOverride), `${inputPath}:ambiguous`) : emptyFastaStats()
    };
  }

  const stats = statSync(resolved);
  if (stats.isDirectory()) {
    return loadDirectoryResultSet(resolved);
  }

  if (isZipPath(resolved)) {
    return loadZipResultSet(resolved);
  }

  return {
    kind: "fasta",
    aligned: parseFastaText(readFileSync(resolved, "utf8"), inputPath),
    ambiguous: options.ambiguousOverride ? parseFastaText(readSafeText(options.ambiguousOverride), `${inputPath}:ambiguous`) : emptyFastaStats()
  };
}

function loadDirectoryResultSet(directoryPath) {
  const files = readdirSync(directoryPath).map((name) => join(directoryPath, name));
  const alignedPath = findFastaPath(files, "aligned");
  const ambiguousPath = findFastaPath(files, "ambiguous");
  if (!alignedPath) {
    throw new Error(`Aligned FASTA not found in directory: ${directoryPath}`);
  }

  return {
    kind: "directory",
    aligned: parseFastaText(readFileSync(alignedPath, "utf8"), basename(alignedPath)),
    ambiguous: ambiguousPath ? parseFastaText(readFileSync(ambiguousPath, "utf8"), basename(ambiguousPath)) : emptyFastaStats()
  };
}

async function loadZipResultSet(zipPath) {
  const buffer = readFileSync(zipPath);
  const reader = new ZipReader(new BlobReader(new Blob([buffer])));
  try {
    const entries = await reader.getEntries();
    const alignedEntry = findZipEntry(entries, "aligned");
    const ambiguousEntry = findZipEntry(entries, "ambiguous");
    if (!alignedEntry) {
      throw new Error(`Aligned FASTA not found in ZIP: ${zipPath}`);
    }

    return {
      kind: "zip",
      aligned: parseFastaText(await alignedEntry.getData(new TextWriter()), alignedEntry.filename),
      ambiguous: ambiguousEntry ? parseFastaText(await ambiguousEntry.getData(new TextWriter()), ambiguousEntry.filename) : emptyFastaStats()
    };
  } finally {
    await reader.close();
  }
}

function readSafeText(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    throw new Error(`FASTA path not found: ${path}`);
  }
  return readFileSync(resolved, "utf8");
}

function findFastaPath(paths, category) {
  return paths.find((path) => isFastaPath(path) && categoryMatches(basename(path), category));
}

function findZipEntry(entries, category) {
  return entries.find((entry) => !entry.directory && isFastaPath(entry.filename) && categoryMatches(entry.filename, category));
}

function categoryMatches(name, category) {
  const normalized = name.toLowerCase();
  if (category === "ambiguous") {
    return normalized.includes("excluded_ambiguous") || normalized.includes("ambiguous");
  }
  return normalized.includes("aligned") && !normalized.includes("ambiguous");
}

function isZipPath(path) {
  return extname(path).toLowerCase() === ".zip";
}

function isFastaPath(path) {
  const lower = path.toLowerCase();
  return lower.endsWith(".fasta") || lower.endsWith(".fa") || lower.endsWith(".fna");
}

function parseFastaText(text, label) {
  const hashes = new Set();
  let recordCount = 0;
  let currentSequence = [];
  let sawHeader = false;
  let sawNonEmpty = false;

  const flushRecord = () => {
    if (!sawHeader) return;
    const normalized = normalizeSequence(currentSequence.join(""));
    if (!normalized) {
      throw new Error(`Malformed FASTA in ${label}: record without sequence`);
    }
    hashes.add(hashSequence(normalized));
    recordCount += 1;
    currentSequence = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    sawNonEmpty = true;
    if (line.startsWith(">")) {
      flushRecord();
      sawHeader = true;
      continue;
    }
    if (!sawHeader) {
      throw new Error(`Malformed FASTA in ${label}: sequence content before first header`);
    }
    currentSequence.push(line);
  }

  if (!sawNonEmpty) {
    return emptyFastaStats();
  }
  flushRecord();
  return { recordCount, uniqueHashes: hashes };
}

function normalizeSequence(sequence) {
  return sequence.replace(/[\s\d.-]/g, "").toUpperCase();
}

function hashSequence(sequence) {
  return createHash("sha256").update(sequence, "ascii").digest("hex");
}

function emptyFastaStats() {
  return { recordCount: 0, uniqueHashes: new Set() };
}

function compareCategory(webStats, sup12Stats) {
  const common = countIntersection(webStats.uniqueHashes, sup12Stats.uniqueHashes);
  return {
    webRecordCount: webStats.recordCount,
    sup12RecordCount: sup12Stats.recordCount,
    webUniqueSequenceHashCount: webStats.uniqueHashes.size,
    sup12UniqueSequenceHashCount: sup12Stats.uniqueHashes.size,
    commonUniqueSequenceHashCount: common,
    webOnlyUniqueSequenceHashCount: webStats.uniqueHashes.size - common,
    sup12OnlyUniqueSequenceHashCount: sup12Stats.uniqueHashes.size - common
  };
}

function countIntersection(left, right) {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function inputSummary(path, kind) {
  return {
    path,
    kind
  };
}

function privacySummary() {
  return {
    rawSequencesPrinted: false,
    rawBlastResultsRead: false,
    fastaHeadersPrinted: false,
    individualHashesPrinted: false
  };
}
