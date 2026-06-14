import { NCBI_BLAST_URL } from "../config/defaults";
import type { CollectionFormState } from "../domain/types";
import { buildEntrezQuery, cleanSequence, hashSequence, summarizeSequence } from "../domain/fasta";

export interface BlastRequestPreview {
  url: string;
  method: "POST";
  params: Record<string, string>;
}

export interface SafeBlastRequestPreview {
  url: string;
  method: "POST";
  params: Record<string, string>;
  query: {
    length: number;
    hash: string;
    maskedPreview: string;
  };
}

export type BlastSearchStatus = "WAITING" | "READY" | "FAILED" | "UNKNOWN" | "NO_HITS";
export type BlastResultFormat = "JSON2_S" | "XML";

export interface BlastSubmitResult {
  rid: string;
  rtoeSeconds: number;
  rawLength: number;
}

export interface BlastSearchInfo {
  rid: string;
  status: BlastSearchStatus;
  checkedAt: string;
  rawLength: number;
}

export interface BlastResultDownload {
  rid: string;
  format: BlastResultFormat;
  downloadedAt: string;
  rawLength: number;
  text: string;
}

export type BlastFetch = typeof fetch;

export class BlastClientError extends Error {
  readonly code: "failed_network" | "failed_cors" | "failed_ncbi" | "failed_parse" | "failed_unknown_rid" | "failed_timeout";

  constructor(code: BlastClientError["code"], message: string) {
    super(message);
    this.name = "BlastClientError";
    this.code = code;
  }
}

export function buildBlastRequestPreview(state: CollectionFormState): BlastRequestPreview {
  const sequence = summarizeSequence(state.referenceSequence);
  const params: Record<string, string> = {
    CMD: "Put",
    PROGRAM: "blastn",
    DATABASE: state.database,
    TASK: state.task,
    QUERY: sequence.fasta,
    ENTREZ_QUERY: buildEntrezQuery(state.taxid),
    HITLIST_SIZE: String(state.maxHits),
    EXPECT: String(state.expect),
    WORD_SIZE: String(state.wordSize),
    tool: state.tool
  };

  if (state.email.trim()) {
    params.email = state.email.trim();
  }

  return {
    url: NCBI_BLAST_URL,
    method: "POST",
    params
  };
}

export function buildSafeBlastRequestPreview(state: CollectionFormState): SafeBlastRequestPreview {
  const request = buildBlastRequestPreview(state);
  const cleaned = cleanSequence(state.referenceSequence);
  const redactedParams = { ...request.params };
  delete redactedParams.QUERY;

  return {
    url: request.url,
    method: request.method,
    params: redactedParams,
    query: {
      length: cleaned.length,
      hash: hashSequence(cleaned),
      maskedPreview: maskSequence(cleaned)
    }
  };
}

export async function submitBlastRequest(state: CollectionFormState, fetcher: BlastFetch = fetch): Promise<BlastSubmitResult> {
  const request = buildBlastRequestPreview(state);
  const body = new URLSearchParams(request.params);
  const responseText = await fetchBlastText(
    fetcher,
    request.url,
    {
      method: request.method,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    },
    "NCBI BLAST 제출에 실패했습니다."
  );
  const parsed = parseRidAndRtoe(responseText);
  if (!parsed.rid) {
    throw new BlastClientError("failed_parse", "NCBI 응답에서 RID를 찾지 못했습니다.");
  }

  return {
    rid: parsed.rid,
    rtoeSeconds: parsed.rtoeSeconds ?? 60,
    rawLength: responseText.length
  };
}

export async function getBlastSearchInfo(rid: string, fetcher: BlastFetch = fetch): Promise<BlastSearchInfo> {
  const normalizedRid = rid.trim();
  if (!normalizedRid) {
    throw new BlastClientError("failed_unknown_rid", "RID가 비어 있어 상태를 확인할 수 없습니다.");
  }

  const url = new URL(NCBI_BLAST_URL);
  url.searchParams.set("CMD", "Get");
  url.searchParams.set("RID", normalizedRid);
  url.searchParams.set("FORMAT_OBJECT", "SearchInfo");

  const responseText = await fetchBlastText(
    fetcher,
    url.toString(),
    {
      method: "GET"
    },
    "NCBI SearchInfo 확인에 실패했습니다."
  );
  if (!/Status=/.test(responseText)) {
    throw new BlastClientError("failed_parse", "NCBI SearchInfo 응답에서 Status 값을 찾지 못했습니다.");
  }

  return {
    rid: normalizedRid,
    status: parseSearchStatus(responseText),
    checkedAt: new Date().toISOString(),
    rawLength: responseText.length
  };
}

export async function downloadBlastResult(rid: string, format: BlastResultFormat = "JSON2_S", fetcher: BlastFetch = fetch): Promise<BlastResultDownload> {
  const normalizedRid = rid.trim();
  if (!normalizedRid) {
    throw new BlastClientError("failed_unknown_rid", "RID가 비어 있어 BLAST 결과를 다운로드할 수 없습니다.");
  }

  const url = new URL(NCBI_BLAST_URL);
  url.searchParams.set("CMD", "Get");
  url.searchParams.set("RID", normalizedRid);
  url.searchParams.set("FORMAT_TYPE", format);

  const text = await fetchBlastText(
    fetcher,
    url.toString(),
    {
      method: "GET"
    },
    `NCBI BLAST 결과 다운로드(${format})에 실패했습니다.`,
    60000
  );

  if (!text.trim()) {
    throw new BlastClientError("failed_parse", "NCBI BLAST 결과 응답이 비어 있습니다.");
  }

  return {
    rid: normalizedRid,
    format,
    downloadedAt: new Date().toISOString(),
    rawLength: text.length,
    text
  };
}

export async function downloadBlastResultWithFallback(rid: string, fetcher: BlastFetch = fetch): Promise<BlastResultDownload> {
  try {
    return await downloadBlastResult(rid, "JSON2_S", fetcher);
  } catch {
    return downloadBlastResult(rid, "XML", fetcher);
  }
}

export function nextPollDelayMs(rtoeSeconds?: number): number {
  const seconds = Math.max(60, Math.ceil(rtoeSeconds ?? 60));
  return seconds * 1000;
}

function maskSequence(sequence: string): string {
  if (!sequence) return "";
  if (sequence.length <= 12) return `${sequence.slice(0, 2)}...${sequence.slice(-2)} (${sequence.length} bp)`;
  return `${sequence.slice(0, 6)}...${sequence.slice(-6)} (${sequence.length} bp)`;
}

export function parseRidAndRtoe(responseText: string): { rid?: string; rtoeSeconds?: number } {
  const rid = responseText.match(/RID\s*=\s*([^\s]+)/)?.[1];
  const rtoeRaw = responseText.match(/RTOE\s*=\s*(\d+)/)?.[1];
  return {
    rid,
    rtoeSeconds: rtoeRaw ? Number.parseInt(rtoeRaw, 10) : undefined
  };
}

export function parseSearchStatus(responseText: string): BlastSearchStatus {
  if (/Status=FAILED/.test(responseText)) return "FAILED";
  if (/Status=UNKNOWN/.test(responseText)) return "UNKNOWN";
  if (/Status=WAITING/.test(responseText)) return "WAITING";
  if (/Status=READY/.test(responseText)) {
    if (/ThereAreHits=yes/.test(responseText)) return "READY";
    if (/ThereAreHits=no/.test(responseText)) return "NO_HITS";
    return "UNKNOWN";
  }
  return "UNKNOWN";
}

async function fetchBlastText(fetcher: BlastFetch, input: RequestInfo | URL, init: RequestInit, fallbackMessage: string, timeoutMs = 30000): Promise<string> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  let response: Response;
  try {
    response = await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BlastClientError("failed_timeout", `${fallbackMessage} ${Math.round(timeoutMs / 1000)}초 안에 응답하지 않았습니다.`);
    }
    throw new BlastClientError(inferNetworkErrorCode(error), `${fallbackMessage} 네트워크 또는 CORS 차단 가능성을 확인하세요.`);
  } finally {
    globalThis.clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new BlastClientError("failed_ncbi", `${fallbackMessage} HTTP ${response.status} 응답을 받았습니다.`);
  }

  return response.text();
}

function inferNetworkErrorCode(error: unknown): BlastClientError["code"] {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("cors") ? "failed_cors" : "failed_network";
}
