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

  it("parses complete XML Hit blocks even when the XML tail is incomplete", () => {
    const incompleteXml = `<?xml version="1.0"?>
<BlastOutput>
  <BlastOutput_iterations>
    <Iteration>
      <Iteration_hits>
        <Hit>
          <Hit_id>gi|1|gb|PARTIAL001.1|</Hit_id>
          <Hit_def>Complete hit before truncated tail</Hit_def>
          <Hit_accession>PARTIAL001</Hit_accession>
          <Hit_hsps>
            <Hsp>
              <Hsp_bit-score>50</Hsp_bit-score>
              <Hsp_evalue>1e-10</Hsp_evalue>
              <Hsp_query-from>1</Hsp_query-from>
              <Hsp_query-to>6</Hsp_query-to>
              <Hsp_hit-from>10</Hsp_hit-from>
              <Hsp_hit-to>15</Hsp_hit-to>
              <Hsp_identity>6</Hsp_identity>
              <Hsp_hseq>ATG-TA</Hsp_hseq>
            </Hsp>
          </Hit_hsps>
        </Hit>
        <Hit>
          <Hit_id>truncated`;

    const result = parseBlastResultSkeleton(incompleteXml, "XML");

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      accession: "PARTIAL001",
      title: "Complete hit before truncated tail",
      sequence: "ATGTA"
    });
    expect(result.diagnostics).toMatchObject({
      completeHitBlocksSeen: 1,
      partialXmlTail: true
    });
    expect(result.logs.some((line) => line.includes("completeHits=1"))).toBe(true);
  });

  it("returns a dropped parse result for malformed JSON without throwing", () => {
    const result = parseBlastResultSkeleton("{not json", "JSON2_S");

    expect(result.records).toHaveLength(0);
    expect(result.dropped).toEqual([{ reason: "JSON parse failed" }]);
    expect(result.logs).toContain("JSON parse failed");
  });
});
