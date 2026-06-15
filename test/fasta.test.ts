import { describe, expect, it } from "vitest";
import { buildEntrezQuery, cleanSequence, hashSequence, summarizeSequence, wrapSequence } from "../src/domain/fasta";

describe("fasta utilities", () => {
  it("cleans FASTA headers, whitespace, digits, and gaps", () => {
    expect(cleanSequence(">x\nAT C-1G\nnn")).toBe("ATCGNN");
  });

  it("cleans NCBI web sequence lines with position numbers and spacing", () => {
    const copiedFromNcbi = `
        1 agcgaaagca ggtagatatt
       61 ctctatcgtc ccgtcaggcc
    `;

    expect(cleanSequence(copiedFromNcbi)).toBe("AGCGAAAGCAGGTAGATATTCTCTATCGTCCCGTCAGGCC");
  });

  it("converts RNA U bases to DNA T bases before downstream use", () => {
    const summary = summarizeSequence("augc uunn");

    expect(cleanSequence("augc uunn")).toBe("ATGCTTNN");
    expect(summary.cleanedLength).toBe(8);
    expect(summary.uCount).toBe(3);
    expect(summary.fasta).toContain("ATGCTTNN");
    expect(hashSequence("AUGC")).toBe(hashSequence("ATGC"));
  });

  it("extracts GenBank ORIGIN sequence and ignores annotation text", () => {
    const genBankText = `LOCUS       SYNTHETIC        12 bp    DNA
DEFINITION  Synthetic minimized record.
FEATURES             Location/Qualifiers
ORIGIN
        1 atgc ttaa
       61 ccgg
//
`;

    expect(cleanSequence(genBankText)).toBe("ATGCTTAACCGG");
  });

  it("summarizes sequence length, N count, invalid characters, and FASTA output", () => {
    const summary = summarizeSequence(">target\nATGCNNX");
    expect(summary.cleanedLength).toBe(7);
    expect(summary.nCount).toBe(2);
    expect(summary.gcPercent).toBe(28.6);
    expect(summary.invalidCharacters).toEqual(["X"]);
    expect(summary.fasta).toContain(">Reference_Seq");
  });

  it("builds txid Entrez query only for numeric taxid", () => {
    expect(buildEntrezQuery("10244")).toBe("(txid10244[ORGN])");
    expect(buildEntrezQuery("Monkeypox")).toBe("");
  });

  it("wraps sequence at requested width", () => {
    expect(wrapSequence("A".repeat(10), 4)).toBe("AAAA\nAAAA\nAA");
  });

  it("hashes cleaned sequence without exposing the sequence itself", () => {
    expect(hashSequence(">x\nAT GC")).toMatch(/^fnv1a32:[a-f0-9]{8}$/);
    expect(hashSequence(">x\nAT GC")).toBe(hashSequence("ATGC"));
  });
});
