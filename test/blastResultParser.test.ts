import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBlastResultSkeleton } from "../src/domain/blastResultParser";

const fixtureDir = join(process.cwd(), "test", "fixtures");

function fixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf8");
}

describe("blast result parser skeleton", () => {
  it("parses synthetic JSON2_S hits, removes gaps, and keeps only the first HSP", () => {
    const result = parseBlastResultSkeleton(fixture("synthetic-json2s-result.json"), "JSON2_S");

    expect(result.format).toBe("JSON2_S");
    expect(result.records).toHaveLength(2);
    expect(result.dropped).toEqual([{ accession: "SYN003", title: "Synthetic missing hsp sequence", reason: "No usable first HSP sequence" }]);
    expect(result.records[0]).toMatchObject({
      accession: "SYN001",
      title: "Synthetic minimized hit one",
      sequence: "ATGCCTA",
      sequenceSource: "hseq",
      hspIndex: 0,
      hitRange: [5, 12],
      queryRange: [1, 8],
      identity: 7,
      evalue: 0.000001,
      bitScore: 42
    });
    expect(result.records[0].sequence).not.toBe("GGGG");
    expect(result.summary.savedCount).toBe(2);
    expect(result.summary.droppedCount).toBe(1);
  });

  it("falls back to qseq when hseq is missing", () => {
    const result = parseBlastResultSkeleton(fixture("synthetic-json2s-result.json"), "JSON2_S");

    expect(result.records[1]).toMatchObject({
      accession: "SYN002",
      title: "Synthetic qseq fallback hit",
      sequence: "TTAACC",
      sequenceSource: "qseq"
    });
  });

  it("parses synthetic XML hits", () => {
    const result = parseBlastResultSkeleton(fixture("synthetic-xml-result.xml"), "XML");

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      accession: "SYNXML001",
      title: "Synthetic minimized XML hit",
      sequence: "ATGTA",
      sequenceSource: "hseq",
      hitRange: [10, 15],
      queryRange: [1, 6],
      identity: 6,
      evalue: 0.00001,
      bitScore: 35
    });
    expect(result.summary.minLength).toBe(5);
    expect(result.summary.maxLength).toBe(5);
  });

  it("returns a dropped parse result for malformed JSON without throwing", () => {
    const result = parseBlastResultSkeleton("{not json", "JSON2_S");

    expect(result.records).toHaveLength(0);
    expect(result.dropped).toEqual([{ reason: "JSON parse failed" }]);
    expect(result.logs).toContain("JSON parse failed");
  });
});
