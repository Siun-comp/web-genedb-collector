import { describe, expect, it } from "vitest";
import { parseBlastResultSkeleton, type BlastParseResult } from "../src/domain/blastResultParser";
import { BlastParserWorkerError, parseBlastResultInWorker, type ParserWorkerLike } from "../src/services/blastParserWorkerClient";
import { handleBlastParserWorkerRequest, type ParserWorkerRequest, type ParserWorkerResponse } from "../src/workers/blastParser.worker";
import { syntheticJson2SResult, syntheticXmlResult } from "./utils/syntheticBlastFixtures";

describe("blast parser worker contract", () => {
  it("returns the same synthetic XML result as the direct parser", () => {
    const text = syntheticXmlResult(4, { qseqEvery: 2, uEvery: 3 });
    const direct = parseBlastResultSkeleton(text, "XML");
    const messages = runWorkerHandler({ type: "parse", requestId: "xml-small", format: "XML", text, rawLength: text.length });
    const complete = completeMessage(messages);

    expect(complete.result).toEqual(direct);
    expect(complete.progress).toMatchObject({
      format: "XML",
      stage: "complete",
      records: 4,
      dropped: 0,
      completeHitBlocksSeen: 4,
      partialXmlTail: false
    });
    expect(complete.result.diagnostics?.qseqFallbackCount).toBe(2);
    expect(complete.result.diagnostics?.resultSequenceNormalization?.uToTCount).toBe(2);
  });

  it("returns the same synthetic JSON2_S result as the direct parser", () => {
    const text = syntheticJson2SResult(3);
    const direct = parseBlastResultSkeleton(text, "JSON2_S");
    const messages = runWorkerHandler({ type: "parse", requestId: "json-small", format: "JSON2_S", text, rawLength: text.length });

    expect(completeMessage(messages).result).toEqual(direct);
    expect(messages.some((message) => message.type === "progress" && message.progress.stage === "json_hits_discovered")).toBe(true);
  });

  it("emits monotonic count-only progress for generated 10k XML hits", () => {
    const text = syntheticXmlResult(10_000, { qseqEvery: 997, uEvery: 1009 });
    const messages = runWorkerHandler({ type: "parse", requestId: "xml-large", format: "XML", text, rawLength: text.length, progressIntervalHits: 2500 });
    const progressMessages = messages.filter((message) => message.type === "progress").map((message) => message.progress);
    const complete = completeMessage(messages);

    expect(complete.result.records).toHaveLength(10_000);
    expect(complete.result.dropped).toHaveLength(0);
    expect(complete.result.diagnostics).toMatchObject({
      completeHitBlocksSeen: 10_000,
      partialXmlTail: false
    });
    expect(progressMessages.length).toBeGreaterThanOrEqual(4);
    expect(progressMessages.map((progress) => progress.processedHits)).toEqual([...progressMessages.map((progress) => progress.processedHits)].sort((left, right) => left - right));
    expect(JSON.stringify(progressMessages)).not.toContain("SYNLARGE");
    expect(JSON.stringify(progressMessages)).not.toContain("ATGCTA");
    expect(JSON.stringify(progressMessages)).not.toContain("RAW_BLAST_RESULT_TEXT");
  });

  it("keeps partial XML tail reporting in worker results", () => {
    const text = syntheticXmlResult(5, { partialTail: true });
    const complete = completeMessage(runWorkerHandler({ type: "parse", requestId: "xml-partial", format: "XML", text, rawLength: text.length }));

    expect(complete.result.records).toHaveLength(5);
    expect(complete.result.diagnostics).toMatchObject({
      completeHitBlocksSeen: 5,
      partialXmlTail: true
    });
    expect(complete.progress.partialXmlTail).toBe(true);
  });

  it("client ignores stale requestId messages and resolves the active worker result", async () => {
    const text = syntheticXmlResult(2);
    const worker = new FakeParserWorker((request, post) => {
      post({
        type: "complete",
        requestId: "stale-request",
        result: parseBlastResultSkeleton(syntheticXmlResult(1), "XML"),
        progress: {
          format: "XML",
          stage: "complete",
          processedHits: 1,
          records: 1,
          dropped: 0,
          completeHitBlocksSeen: 1,
          partialXmlTail: false,
          rawLength: 1,
          elapsedMs: 0
        }
      });
      handleBlastParserWorkerRequest(request, post);
    });
    const result = await parseBlastResultInWorker(text, "XML", { workerFactory: () => worker, timeoutMs: 5000 });

    expect(result.records).toHaveLength(2);
    expect(worker.terminated).toBe(true);
  });

  it("client sanitizes worker failure messages", async () => {
    const worker = new FakeParserWorker((request, post) => {
      post({
        type: "error",
        requestId: request.requestId,
        message: "Quota failed AAAACCCCGGGGTTTTAAAACCCC RAW_BLAST_RESULT_TEXT",
        elapsedMs: 1
      });
    });

    await expect(parseBlastResultInWorker(syntheticXmlResult(1), "XML", { workerFactory: () => worker, timeoutMs: 5000 })).rejects.toMatchObject({
      name: "BlastParserWorkerError",
      code: "failed_parse",
      message: expect.stringContaining("[redacted_sequence]")
    } satisfies Partial<BlastParserWorkerError>);
  });
});

function runWorkerHandler(request: ParserWorkerRequest): ParserWorkerResponse[] {
  const messages: ParserWorkerResponse[] = [];
  handleBlastParserWorkerRequest(request, (message) => messages.push(message));
  return messages;
}

function completeMessage(messages: ParserWorkerResponse[]): Extract<ParserWorkerResponse, { type: "complete" }> {
  const complete = messages.find((message): message is Extract<ParserWorkerResponse, { type: "complete" }> => message.type === "complete");
  expect(complete).toBeDefined();
  return complete!;
}

class FakeParserWorker implements ParserWorkerLike {
  onmessage: ((event: MessageEvent<ParserWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor(private readonly responder: (request: ParserWorkerRequest, post: (message: ParserWorkerResponse) => void) => void) {}

  postMessage(request: ParserWorkerRequest): void {
    globalThis.setTimeout(() => {
      if (this.terminated) return;
      this.responder(request, (message) => this.onmessage?.({ data: message } as MessageEvent<ParserWorkerResponse>));
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}
