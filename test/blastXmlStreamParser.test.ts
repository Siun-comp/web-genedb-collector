import { describe, expect, it } from "vitest";
import { parseBlastResultSkeleton } from "../src/domain/blastResultParser";
import { parseBlastXmlReadableStream, type BlastXmlStreamProgress } from "../src/domain/blastXmlStreamParser";
import { syntheticXmlResult } from "./utils/syntheticBlastFixtures";

describe("blast XML streaming parser prototype", () => {
  it("matches the direct XML parser for synthetic XML split into irregular chunks", async () => {
    const text = syntheticXmlResult(6, { qseqEvery: 2, uEvery: 3 });
    const direct = parseBlastResultSkeleton(text, "XML");
    const progress: BlastXmlStreamProgress[] = [];

    const streamed = await parseBlastXmlReadableStream(streamFromText(text, [1, 2, 7, 13, 5]), {
      progressIntervalHits: 2,
      onProgress: (item) => progress.push(item)
    });

    expect(streamed).toEqual(direct);
    expect(progress.some((item) => item.stage === "parsing_hits")).toBe(true);
    expect(JSON.stringify(progress)).not.toContain("SYNLARGE");
    expect(JSON.stringify(progress)).not.toContain("ATGCTA");
    expect(JSON.stringify(progress)).not.toContain("RAW_BLAST_RESULT_TEXT");
  });

  it("recovers only complete Hit blocks when the stream ends with a partial tail", async () => {
    const text = syntheticXmlResult(5, { partialTail: true });
    const result = await parseBlastXmlReadableStream(streamFromText(text, [3, 1, 11, 2]), { progressIntervalHits: 1 });

    expect(result.records).toHaveLength(5);
    expect(result.diagnostics).toMatchObject({
      completeHitBlocksSeen: 5,
      partialXmlTail: true
    });
  });

  it("handles chunk boundaries inside Hit and HSP tags", async () => {
    const text = syntheticXmlResult(2, { uEvery: 1 });
    const result = await parseBlastXmlReadableStream(streamFromText(text, [4, 1, 1, 1, 1]), { progressIntervalHits: 1 });

    expect(result.records).toHaveLength(2);
    expect(result.records[0].sequence).toBe("ATGCT");
    expect(result.diagnostics?.resultSequenceNormalization?.uToTCount).toBe(4);
  });

  it("salvages complete Hit blocks after a stream read error without leaking raw text", async () => {
    const completeHitText = syntheticXmlResult(1, { partialTail: true }).replace("<Hit><Hit_id>truncated", "");
    const progress: BlastXmlStreamProgress[] = [];

    const result = await parseBlastXmlReadableStream(erroringStreamAfterText(completeHitText), {
      progressIntervalHits: 1,
      onProgress: (item) => progress.push(item)
    });

    expect(result.records).toHaveLength(1);
    expect(result.diagnostics?.partialXmlTail).toBe(true);
    expect(result.diagnostics?.parserWarnings.join("\n")).toContain("[redacted_sequence]");
    expect(result.diagnostics?.parserWarnings.join("\n")).not.toContain("RAW_BLAST_RESULT_TEXT");
    expect(JSON.stringify(progress)).not.toContain("RAW_BLAST_RESULT_TEXT");
  });
});

function streamFromText(text: string, chunkSizes: number[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let offset = 0;
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= text.length) {
        controller.close();
        return;
      }
      const size = chunkSizes[index % chunkSizes.length];
      index += 1;
      const chunk = text.slice(offset, offset + size);
      offset += size;
      controller.enqueue(encoder.encode(chunk));
    }
  });
}

function erroringStreamAfterText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoder.encode(text));
        return;
      }
      controller.error(new Error("Stream failed AAAACCCCGGGGTTTTAAAACCCC RAW_BLAST_RESULT_TEXT"));
    }
  });
}
