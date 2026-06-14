import type { SequenceSummary } from "./types";

const DNA_ALLOWED = new Set(["A", "C", "G", "T", "U", "N", "R", "Y", "S", "W", "K", "M", "B", "D", "H", "V"]);
const PROTEIN_HINTS = new Set(["E", "F", "I", "L", "P", "Q", "Z", "*"]);

export function stripFastaHeader(input: string): string {
  return input
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");
}

export function cleanSequence(input: string): string {
  return stripFastaHeader(input)
    .replace(/[0-9\s]/g, "")
    .replace(/-/g, "")
    .toUpperCase();
}

export function summarizeSequence(input: string): SequenceSummary {
  const cleaned = cleanSequence(input);
  const invalidCharacters = Array.from(new Set(cleaned.split("").filter((char) => !DNA_ALLOWED.has(char)))).sort();
  const nCount = cleaned.split("").filter((char) => char === "N").length;
  const uCount = cleaned.split("").filter((char) => char === "U").length;
  const ambiguousIupacCount = cleaned.split("").filter((char) => DNA_ALLOWED.has(char) && !["A", "C", "G", "T", "U", "N"].includes(char)).length;
  const gcCount = cleaned.split("").filter((char) => char === "G" || char === "C").length;
  const gcPercent = cleaned.length > 0 ? Math.round((gcCount / cleaned.length) * 1000) / 10 : null;
  const proteinHintCount = cleaned.split("").filter((char) => PROTEIN_HINTS.has(char)).length;
  const looksProteinLike = cleaned.length > 0 && proteinHintCount / cleaned.length > 0.08;
  const fasta = cleaned ? `>Reference_Seq\n${wrapSequence(cleaned)}\n` : "";

  return {
    rawLength: input.length,
    cleanedLength: cleaned.length,
    nCount,
    ambiguousIupacCount,
    gcPercent,
    uCount,
    invalidCharacters,
    looksProteinLike,
    fasta
  };
}

export function wrapSequence(sequence: string, width = 80): string {
  const chunks: string[] = [];
  for (let index = 0; index < sequence.length; index += width) {
    chunks.push(sequence.slice(index, index + width));
  }
  return chunks.join("\n");
}

export function buildEntrezQuery(taxid: string): string {
  const normalized = taxid.trim();
  if (!/^\d+$/.test(normalized)) {
    return "";
  }
  return `(txid${normalized}[ORGN])`;
}

export function hashSequence(sequence: string): string {
  let hash = 2166136261;
  for (const char of cleanSequence(sequence)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
