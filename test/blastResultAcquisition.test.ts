import { describe, expect, it, vi } from "vitest";
import { acquireBlastResultWithStreamingXmlFallback } from "../src/services/blastResultAcquisition";
import { syntheticJson2SResult, syntheticXmlResult } from "./utils/syntheticBlastFixtures";

describe("blast result acquisition with XML streaming fallback", () => {
  it("uses JSON2_S text download when JSON2_S succeeds", async () => {
    const fetcher = vi.fn(async () => new Response(syntheticJson2SResult(2), { status: 200 }));

    const acquisition = await acquireBlastResultWithStreamingXmlFallback("RID123", fetcher as typeof fetch, { hitlistSize: 20000, ncbiGi: true });

    expect(acquisition.kind).toBe("text");
    expect(acquisition.mode).toBe("text_json2_worker");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String((fetcher.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>)[0][0])).searchParams.get("FORMAT_TYPE")).toBe("JSON2_S");
  });

  it("streams XML and parses complete Hit blocks after JSON2_S fails", async () => {
    const progress: unknown[] = [];
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("not json", { status: 200 }))
      .mockResolvedValueOnce(new Response(streamFromText(syntheticXmlResult(3, { partialTail: true }), [2, 5, 1]), { status: 200 }));

    const acquisition = await acquireBlastResultWithStreamingXmlFallback("RID123", fetcher as typeof fetch, {
      hitlistSize: 100000,
      ncbiGi: true,
      onStreamingProgress: (item) => progress.push(item)
    });

    expect(acquisition.kind).toBe("stream");
    expect(acquisition.mode).toBe("streaming_xml");
    if (acquisition.kind !== "stream") throw new Error("expected stream acquisition");
    expect(acquisition.parseResult.records).toHaveLength(3);
    expect(acquisition.parseResult.diagnostics).toMatchObject({
      completeHitBlocksSeen: 3,
      partialXmlTail: true
    });
    expect(acquisition.fallback).toMatchObject({
      status: "fallback_succeeded",
      primaryFailure: {
        format: "JSON2_S",
        reason: "parse_failed",
        code: "failed_parse"
      }
    });
    expect(JSON.stringify(progress)).not.toContain("SYNLARGE");
    expect(JSON.stringify(progress)).not.toContain("ATGCTA");
  });

  it("falls back to XML text download when ReadableStream is unavailable", async () => {
    const streamlessResponse = { ok: true, status: 200, body: null } as Response;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("not json", { status: 200 }))
      .mockResolvedValueOnce(streamlessResponse)
      .mockResolvedValueOnce(new Response(syntheticXmlResult(1), { status: 200 }));

    const acquisition = await acquireBlastResultWithStreamingXmlFallback("RID123", fetcher as typeof fetch, { hitlistSize: 50000 });

    expect(acquisition.kind).toBe("text");
    expect(acquisition.mode).toBe("text_xml_worker_after_stream_unavailable");
    expect(acquisition.streamingAttempt).toMatchObject({
      attempted: true,
      status: "text_fallback_succeeded",
      failure: {
        reason: "network_or_cors",
        code: "failed_network"
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new URL(String((fetcher.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>)[2][0])).searchParams.get("FORMAT_TYPE")).toBe("XML");
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
