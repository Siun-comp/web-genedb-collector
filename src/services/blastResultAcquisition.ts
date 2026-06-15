import { NCBI_BLAST_URL } from "../config/defaults";
import { parseBlastXmlReadableStream, type BlastXmlStreamProgress } from "../domain/blastXmlStreamParser";
import type { BlastParseResult } from "../domain/blastResultParser";
import {
  BlastClientError,
  classifyDownloadFailure,
  downloadBlastResult,
  formatFailureForLog,
  type BlastFetch,
  type BlastResultDownload,
  type BlastResultDownloadOptions,
  type BlastResultFailure,
  type BlastResultFallback
} from "./blastClient";

export type BlastResultAcquisitionMode = "text_json2_worker" | "streaming_xml" | "text_xml_worker_after_stream_unavailable" | "text_xml_worker_after_stream_failure";

export interface BlastStreamingAttempt {
  attempted: boolean;
  status: "not_attempted" | "stream_succeeded" | "stream_unavailable" | "stream_failed" | "text_fallback_succeeded" | "text_fallback_failed";
  failure?: BlastResultFailure;
  rawLength?: number;
  completeHitBlocksSeen?: number;
  partialXmlTail?: boolean;
}

export type BlastResultAcquisition =
  | {
      kind: "text";
      mode: BlastResultAcquisitionMode;
      result: BlastResultDownload;
      streamingAttempt?: BlastStreamingAttempt;
    }
  | {
      kind: "stream";
      mode: "streaming_xml";
      rid: string;
      format: "XML";
      downloadedAt: string;
      rawLength: number;
      parseResult: BlastParseResult;
      fallback: BlastResultFallback;
      streamingAttempt: BlastStreamingAttempt;
    };

export interface AcquireBlastResultOptions extends BlastResultDownloadOptions {
  tryXmlStreaming?: boolean;
  onStreamingProgress?: (progress: BlastXmlStreamProgress) => void;
}

export async function acquireBlastResultWithStreamingXmlFallback(
  rid: string,
  fetcher: BlastFetch = fetch,
  options: AcquireBlastResultOptions = {}
): Promise<BlastResultAcquisition> {
  try {
    const jsonResult = await downloadBlastResult(rid, "JSON2_S", fetcher, options);
    return {
      kind: "text",
      mode: "text_json2_worker",
      result: {
        ...jsonResult,
        fallback: {
          attempted: false,
          status: "not_needed",
          primaryFormat: "JSON2_S",
          fallbackFormat: "XML",
          finalFormat: "JSON2_S"
        }
      },
      streamingAttempt: { attempted: false, status: "not_attempted" }
    };
  } catch (primaryError) {
    const primaryFailure = classifyDownloadFailure(primaryError, "JSON2_S");

    if (options.tryXmlStreaming !== false) {
      try {
        const streamResult = await downloadAndParseXmlStream(rid, fetcher, options);
        const fallback: BlastResultFallback = {
          attempted: true,
          status: "fallback_succeeded",
          primaryFormat: "JSON2_S",
          fallbackFormat: "XML",
          primaryFailure,
          finalFormat: "XML"
        };
        return {
          kind: "stream",
          mode: "streaming_xml",
          rid: streamResult.rid,
          format: "XML",
          downloadedAt: streamResult.downloadedAt,
          rawLength: streamResult.rawLength,
          parseResult: streamResult.parseResult,
          fallback,
          streamingAttempt: {
            attempted: true,
            status: "stream_succeeded",
            rawLength: streamResult.rawLength,
            completeHitBlocksSeen: streamResult.parseResult.diagnostics?.completeHitBlocksSeen,
            partialXmlTail: streamResult.parseResult.diagnostics?.partialXmlTail
          }
        };
      } catch (streamError) {
        const streamFailure = classifyDownloadFailure(streamError, "XML");
        return downloadXmlTextAfterStreamFailure(rid, fetcher, options, primaryFailure, streamFailure);
      }
    }

    return downloadXmlTextAfterStreamFailure(rid, fetcher, options, primaryFailure, {
      format: "XML",
      reason: "unknown",
      code: "unknown",
      message: "XML streaming was not attempted."
    });
  }
}

async function downloadXmlTextAfterStreamFailure(
  rid: string,
  fetcher: BlastFetch,
  options: BlastResultDownloadOptions,
  primaryFailure: BlastResultFailure,
  streamFailure: BlastResultFailure
): Promise<BlastResultAcquisition> {
  try {
    const xmlResult = await downloadBlastResult(rid, "XML", fetcher, options);
    const streamUnavailable = /ReadableStream unavailable/i.test(streamFailure.message);
    return {
      kind: "text",
      mode: streamUnavailable ? "text_xml_worker_after_stream_unavailable" : "text_xml_worker_after_stream_failure",
      result: {
        ...xmlResult,
        json2FailureReason: `${primaryFailure.code}: ${primaryFailure.message}`,
        fallback: {
          attempted: true,
          status: "fallback_succeeded",
          primaryFormat: "JSON2_S",
          fallbackFormat: "XML",
          primaryFailure,
          finalFormat: "XML"
        }
      },
      streamingAttempt: {
        attempted: true,
        status: "text_fallback_succeeded",
        failure: streamFailure
      }
    };
  } catch (fallbackError) {
    const fallbackFailure = classifyDownloadFailure(fallbackError, "XML");
    const fallback: BlastResultFallback = {
      attempted: true,
      status: "fallback_failed",
      primaryFormat: "JSON2_S",
      fallbackFormat: "XML",
      primaryFailure,
      fallbackFailure
    };
    throw new BlastClientError(
      fallbackFailure.code === "unknown" ? "failed_network" : fallbackFailure.code,
      `JSON2_S download failed and XML fallback also failed. primary=${formatFailureForLog(primaryFailure)}; stream=${formatFailureForLog(streamFailure)}; fallback=${formatFailureForLog(fallbackFailure)}`,
      fallback
    );
  }
}

async function downloadAndParseXmlStream(
  rid: string,
  fetcher: BlastFetch,
  options: AcquireBlastResultOptions
): Promise<{ rid: string; downloadedAt: string; rawLength: number; parseResult: BlastParseResult }> {
  const normalizedRid = rid.trim();
  if (!normalizedRid) {
    throw new BlastClientError("failed_unknown_rid", "RID is empty; XML streaming result download cannot start.");
  }

  const url = new URL(NCBI_BLAST_URL);
  url.searchParams.set("CMD", "Get");
  url.searchParams.set("RID", normalizedRid);
  url.searchParams.set("FORMAT_TYPE", "XML");
  if (Number.isInteger(options.hitlistSize) && options.hitlistSize !== undefined && options.hitlistSize > 0) {
    url.searchParams.set("HITLIST_SIZE", String(options.hitlistSize));
  }
  if (options.ncbiGi) {
    url.searchParams.set("NCBI_GI", "yes");
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 60000;
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let latestProgress: BlastXmlStreamProgress | undefined;

  try {
    const response = await fetcher(url.toString(), { method: "GET", signal: controller.signal });
    if (!response.ok) {
      throw new BlastClientError("failed_ncbi", `NCBI BLAST XML streaming download failed with HTTP ${response.status}.`);
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      throw new BlastClientError("failed_network", "ReadableStream unavailable for NCBI BLAST XML response.");
    }

    const parseResult = await parseBlastXmlReadableStream(response.body, {
      progressIntervalHits: 1000,
      onProgress: (progress) => {
        latestProgress = progress;
        options.onStreamingProgress?.(progress);
      },
      salvagePartialOnReadError: true
    });

    return {
      rid: normalizedRid,
      downloadedAt: new Date().toISOString(),
      rawLength: latestProgress?.rawLength ?? 0,
      parseResult
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw new BlastClientError("failed_timeout", `NCBI BLAST XML streaming download did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    if (error instanceof BlastClientError) throw error;
    throw new BlastClientError("failed_network", `NCBI BLAST XML streaming download failed. ${safeStreamError(error)}`);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function safeStreamError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/RAW_BLAST_RESULT_TEXT/gi, "[redacted_raw_result]")
    .replace(/\b[ACGTUNRYSWKMBDHV]{20,}\b/gi, "[redacted_sequence]");
}
