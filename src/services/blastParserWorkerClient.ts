import type { BlastParseResult } from "../domain/blastResultParser";
import type { JobStatus } from "../domain/types";
import type { BlastResultFormat } from "./blastClient";
import type { ParserWorkerProgress, ParserWorkerRequest, ParserWorkerResponse } from "../workers/blastParser.worker";

export type { ParserWorkerProgress } from "../workers/blastParser.worker";

export interface ParserWorkerLike {
  onmessage: ((event: MessageEvent<ParserWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ParserWorkerRequest): void;
  terminate(): void;
}

export interface ParseBlastResultInWorkerOptions {
  progressIntervalHits?: number;
  timeoutMs?: number;
  workerFactory?: () => ParserWorkerLike;
  onProgress?: (progress: ParserWorkerProgress) => void;
}

export class BlastParserWorkerError extends Error {
  readonly code: JobStatus = "failed_parse";

  constructor(message: string) {
    super(message);
    this.name = "BlastParserWorkerError";
  }
}

let nextParserRequestId = 1;

export function parseBlastResultInWorker(
  text: string,
  format: BlastResultFormat,
  options: ParseBlastResultInWorkerOptions = {}
): Promise<BlastParseResult> {
  const requestId = `parse-${Date.now()}-${nextParserRequestId++}`;
  const worker = (options.workerFactory ?? createBlastParserWorker)();
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;

  return new Promise((resolve, reject) => {
    let completed = false;
    const timeout = globalThis.setTimeout(() => {
      finish(() => reject(new BlastParserWorkerError("BLAST result parser worker timed out.")));
    }, timeoutMs);

    function finish(done: () => void): void {
      if (completed) return;
      completed = true;
      globalThis.clearTimeout(timeout);
      worker.terminate();
      done();
    }

    worker.onmessage = (event: MessageEvent<ParserWorkerResponse>) => {
      const message = event.data;
      if (!message || message.requestId !== requestId) return;

      if (message.type === "started" || message.type === "progress") {
        options.onProgress?.(message.progress);
        return;
      }

      if (message.type === "complete") {
        options.onProgress?.(message.progress);
        finish(() => resolve(message.result));
        return;
      }

      if (message.type === "error") {
        finish(() => reject(new BlastParserWorkerError(safeWorkerError(message.message))));
      }
    };

    worker.onerror = (event: ErrorEvent) => {
      finish(() => reject(new BlastParserWorkerError(safeWorkerError(event.message || "BLAST result parser worker failed."))));
    };

    worker.postMessage({
      type: "parse",
      requestId,
      text,
      format,
      rawLength: text.length,
      progressIntervalHits: options.progressIntervalHits
    });
  });
}

function createBlastParserWorker(): ParserWorkerLike {
  return new Worker(new URL("../workers/blastParser.worker.ts", import.meta.url), { type: "module" });
}

function safeWorkerError(message: string): string {
  return message
    .replace(/RAW_BLAST_RESULT_TEXT/gi, "[redacted_raw_result]")
    .replace(/\b[ACGTUNRYSWKMBDHV]{20,}\b/gi, "[redacted_sequence]");
}
