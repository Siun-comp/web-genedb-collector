import { afterEach, describe, expect, it, vi } from "vitest";
import { BLAST_DEFAULTS, FILTER_DEFAULTS } from "../src/config/defaults";
import {
  buildBlastRequestPreview,
  buildSafeBlastRequestPreview,
  downloadBlastResult,
  downloadBlastResultWithFallback,
  getBlastSearchInfo,
  nextPollDelayMs,
  parseRidAndRtoe,
  parseSearchStatus,
  submitBlastRequest
} from "../src/services/blastClient";
import type { CollectionFormState } from "../src/domain/types";

const state: CollectionFormState = {
  taskName: "test",
  referenceSequence: "ATGC",
  taxid: "10244",
  database: BLAST_DEFAULTS.database,
  task: BLAST_DEFAULTS.task,
  maxHits: BLAST_DEFAULTS.maxHits,
  expect: BLAST_DEFAULTS.expect,
  wordSize: BLAST_DEFAULTS.wordSize,
  tool: BLAST_DEFAULTS.tool,
  email: "",
  lengthFilterEnabled: FILTER_DEFAULTS.lengthFilterEnabled,
  minLengthPercent: FILTER_DEFAULTS.minLengthPercent,
  maxLengthPercent: FILTER_DEFAULTS.maxLengthPercent,
  keywordFilterEnabled: FILTER_DEFAULTS.keywordFilterEnabled,
  keywords: FILTER_DEFAULTS.keywords.join(", "),
  excludeAmbiguousN: FILTER_DEFAULTS.excludeAmbiguousN
};

describe("blast client helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("builds default NCBI BLAST request parameters", () => {
    const preview = buildBlastRequestPreview(state);
    expect(preview.params.CMD).toBe("Put");
    expect(preview.params.PROGRAM).toBe("blastn");
    expect(preview.params.DATABASE).toBe("core_nt");
    expect(preview.params.TASK).toBe("megablast");
    expect(preview.params.HITLIST_SIZE).toBe("20000");
    expect(preview.params.ENTREZ_QUERY).toBe("(txid10244[ORGN])");
  });

  it("keeps full QUERY only in the real request, not the safe UI preview", () => {
    const preview = buildBlastRequestPreview({ ...state, referenceSequence: "ATGCGTACGTAGCTAGCTAG" });
    const safePreview = buildSafeBlastRequestPreview({ ...state, referenceSequence: "ATGCGTACGTAGCTAGCTAG" });

    expect(preview.params.QUERY).toContain("ATGCGTACGTAGCTAGCTAG");
    expect(safePreview.params.QUERY).toBeUndefined();
    expect(safePreview.query.length).toBe(20);
    expect(safePreview.query.maskedPreview).not.toContain("ATGCGTACGTAGCTAGCTAG");
    expect(safePreview.query.hash).toMatch(/^fnv1a32:[a-f0-9]{8}$/);
  });

  it("builds QUERY from cleaned NCBI-style numbered sequence text", () => {
    const ncbiStyle = `1 atgc gtac
61 gcta gcta`;
    const plain = "ATGCGTACGCTAGCTA";
    const preview = buildBlastRequestPreview({ ...state, referenceSequence: ncbiStyle });
    const safePreview = buildSafeBlastRequestPreview({ ...state, referenceSequence: ncbiStyle });
    const plainSafePreview = buildSafeBlastRequestPreview({ ...state, referenceSequence: plain });

    expect(preview.params.QUERY.replace(/^>Reference_Seq\s*/, "").replace(/\s/g, "")).toBe(plain);
    expect(preview.params.QUERY).not.toContain("61");
    expect(preview.params.QUERY).not.toContain("atgc gtac");
    expect(safePreview.params.QUERY).toBeUndefined();
    expect(safePreview.query.length).toBe(plain.length);
    expect(safePreview.query.hash).toBe(plainSafePreview.query.hash);
  });

  it("builds QUERY from RNA by converting U to T", () => {
    const preview = buildBlastRequestPreview({ ...state, referenceSequence: "augc uunn" });

    expect(preview.params.QUERY).toContain("ATGCTTNN");
    expect(preview.params.QUERY).not.toContain("U");
  });

  it("builds QUERY from GenBank ORIGIN records without annotation labels", () => {
    const genBankText = `LOCUS       SYNTHETIC        12 bp    DNA
FEATURES             Location/Qualifiers
ORIGIN
        1 atgc ttaa
       61 ccgg
//
`;
    const preview = buildBlastRequestPreview({ ...state, referenceSequence: genBankText });

    expect(preview.params.QUERY.replace(/^>Reference_Seq\s*/, "").replace(/\s/g, "")).toBe("ATGCTTAACCGG");
    expect(preview.params.QUERY).not.toContain("LOCUS");
    expect(preview.params.QUERY).not.toContain("ORIGIN");
  });

  it("parses RID and RTOE from NCBI response text", () => {
    const parsed = parseRidAndRtoe("RID = ABC123\nRTOE = 45\n");
    expect(parsed).toEqual({ rid: "ABC123", rtoeSeconds: 45 });
  });

  it("parses RID and RTOE with CRLF and missing RTOE", () => {
    expect(parseRidAndRtoe("  RID   =   XYZ789\r\n  RTOE   =   12\r\n")).toEqual({ rid: "XYZ789", rtoeSeconds: 12 });
    expect(parseRidAndRtoe("RID = XYZ789\r\n")).toEqual({ rid: "XYZ789", rtoeSeconds: undefined });
  });

  it("parses SearchInfo statuses", () => {
    expect(parseSearchStatus("Status=WAITING")).toBe("WAITING");
    expect(parseSearchStatus("Status=FAILED")).toBe("FAILED");
    expect(parseSearchStatus("Status=UNKNOWN")).toBe("UNKNOWN");
    expect(parseSearchStatus("Status=READY\nThereAreHits=yes")).toBe("READY");
    expect(parseSearchStatus("Status=READY\nThereAreHits=no")).toBe("NO_HITS");
    expect(parseSearchStatus("Status=READY")).toBe("UNKNOWN");
    expect(parseSearchStatus("unexpected response")).toBe("UNKNOWN");
  });

  it("submits CMD=Put as form body and parses RID/RTOE", async () => {
    const fetcher = vi.fn(async () => new Response("RID = RID123\nRTOE = 75\n", { status: 200 }));
    const result = await submitBlastRequest({ ...state, referenceSequence: "ATGCGTACGTAGCTAGCTAG" }, fetcher as typeof fetch);
    const [url, init] = (fetcher.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>)[0];
    const body = init?.body as URLSearchParams;

    expect(String(url)).toBe("https://blast.ncbi.nlm.nih.gov/Blast.cgi");
    expect(init?.method).toBe("POST");
    expect(body.get("CMD")).toBe("Put");
    expect(body.get("QUERY")).toContain("ATGCGTACGTAGCTAGCTAG");
    expect(body.get("DATABASE")).toBe("core_nt");
    expect(body.get("PROGRAM")).toBe("blastn");
    expect(body.get("ENTREZ_QUERY")).toBe("(txid10244[ORGN])");
    expect(body.get("HITLIST_SIZE")).toBe("20000");
    expect(result).toEqual({ rid: "RID123", rtoeSeconds: 75, rawLength: 23 });
  });

  it("does not write full sequence to console during submit", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher = vi.fn(async () => new Response("RID = RID123\nRTOE = 75\n", { status: 200 }));

    await submitBlastRequest({ ...state, referenceSequence: "ATGCGTACGTAGCTAGCTAG" }, fetcher as typeof fetch);

    expect(JSON.stringify(logSpy.mock.calls)).not.toContain("ATGCGTACGTAGCTAGCTAG");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("ATGCGTACGTAGCTAGCTAG");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("ATGCGTACGTAGCTAGCTAG");
  });

  it("fails submit when RID is missing", async () => {
    const fetcher = vi.fn(async () => new Response("RTOE = 75\n", { status: 200 }));
    await expect(submitBlastRequest(state, fetcher as typeof fetch)).rejects.toMatchObject({ code: "failed_parse" });
  });

  it("gets SearchInfo and parses status", async () => {
    const fetcher = vi.fn(async () => new Response("Status=READY\nThereAreHits=yes\n", { status: 200 }));
    const result = await getBlastSearchInfo("RID123", fetcher as typeof fetch);
    const [url, init] = (fetcher.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>)[0];

    expect(String(url)).toContain("CMD=Get");
    expect(String(url)).toContain("RID=RID123");
    expect(String(url)).toContain("FORMAT_OBJECT=SearchInfo");
    expect(init?.method).toBe("GET");
    expect(result.status).toBe("READY");
    expect(result.rid).toBe("RID123");
  });

  it("downloads BLAST results without sending QUERY or SearchInfo format object", async () => {
    const fetcher = vi.fn(async () => new Response('{"BlastOutput2":[]}', { status: 200 }));
    const result = await downloadBlastResult("RID123", "JSON2_S", fetcher as typeof fetch, { hitlistSize: 50000, ncbiGi: true });
    const [url, init] = (fetcher.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>)[0];
    const parsedUrl = new URL(String(url));

    expect(parsedUrl.searchParams.get("CMD")).toBe("Get");
    expect(parsedUrl.searchParams.get("RID")).toBe("RID123");
    expect(parsedUrl.searchParams.get("FORMAT_TYPE")).toBe("JSON2_S");
    expect(parsedUrl.searchParams.get("HITLIST_SIZE")).toBe("50000");
    expect(parsedUrl.searchParams.get("NCBI_GI")).toBe("yes");
    expect(parsedUrl.searchParams.has("QUERY")).toBe(false);
    expect(parsedUrl.searchParams.has("FORMAT_OBJECT")).toBe(false);
    expect(init?.method).toBe("GET");
    expect(result).toMatchObject({ rid: "RID123", format: "JSON2_S", rawLength: 19 });
  });

  it("falls back to XML result download when JSON2_S download fails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(new Response("<BlastOutput></BlastOutput>", { status: 200 }));

    const result = await downloadBlastResultWithFallback("RID123", fetcher as typeof fetch, { hitlistSize: 50000, ncbiGi: true });
    const calls = fetcher.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;

    expect(new URL(String(calls[0][0])).searchParams.get("FORMAT_TYPE")).toBe("JSON2_S");
    expect(new URL(String(calls[1][0])).searchParams.get("FORMAT_TYPE")).toBe("XML");
    expect(new URL(String(calls[1][0])).searchParams.get("HITLIST_SIZE")).toBe("50000");
    expect(new URL(String(calls[1][0])).searchParams.get("NCBI_GI")).toBe("yes");
    expect(result.format).toBe("XML");
    expect(result.text).toBe("<BlastOutput></BlastOutput>");
    expect(result.json2FailureReason).toContain("failed_ncbi");
    expect(result.fallback).toMatchObject({
      attempted: true,
      status: "fallback_succeeded",
      primaryFormat: "JSON2_S",
      fallbackFormat: "XML",
      finalFormat: "XML",
      primaryFailure: {
        format: "JSON2_S",
        reason: "http_status",
        code: "failed_ncbi"
      }
    });
  });

  it("falls back to XML when JSON2_S response is malformed JSON", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("not json", { status: 200 }))
      .mockResolvedValueOnce(new Response("<BlastOutput></BlastOutput>", { status: 200 }));

    const result = await downloadBlastResultWithFallback("RID123", fetcher as typeof fetch);

    expect(result.format).toBe("XML");
    expect(result.fallback?.primaryFailure).toMatchObject({
      format: "JSON2_S",
      reason: "parse_failed",
      code: "failed_parse"
    });
  });

  it("classifies empty JSON2_S response before XML fallback", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("   ", { status: 200 }))
      .mockResolvedValueOnce(new Response("<BlastOutput></BlastOutput>", { status: 200 }));

    const result = await downloadBlastResultWithFallback("RID123", fetcher as typeof fetch);

    expect(result.format).toBe("XML");
    expect(result.fallback?.primaryFailure).toMatchObject({
      reason: "empty_response",
      code: "failed_parse"
    });
  });

  it("preserves both JSON2_S and XML failures when fallback also fails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("RAW_BLAST_RESULT_TEXT", { status: 200 }))
      .mockRejectedValueOnce(new TypeError("Network unavailable"));
    let capturedError: unknown;

    try {
      await downloadBlastResultWithFallback("RID123", fetcher as typeof fetch);
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toMatchObject({
      code: "failed_network",
      fallback: {
        status: "fallback_failed",
        primaryFailure: {
          format: "JSON2_S",
          reason: "parse_failed",
          code: "failed_parse"
        },
        fallbackFailure: {
          format: "XML",
          reason: "network_or_cors",
          code: "failed_network"
        }
      }
    });
    expect(capturedError instanceof Error ? capturedError.message : String(capturedError)).not.toContain("RAW_BLAST_RESULT_TEXT");
  });

  it("rejects result download when RID is empty", async () => {
    await expect(downloadBlastResult("   ", "JSON2_S", vi.fn() as typeof fetch)).rejects.toMatchObject({ code: "failed_unknown_rid" });
  });

  it("separates malformed SearchInfo, HTTP errors, and network errors", async () => {
    await expect(getBlastSearchInfo("RID123", vi.fn(async () => new Response("not status", { status: 200 })) as typeof fetch)).rejects.toMatchObject({
      code: "failed_parse"
    });
    await expect(getBlastSearchInfo("RID123", vi.fn(async () => new Response("server error", { status: 500 })) as typeof fetch)).rejects.toMatchObject({
      code: "failed_ncbi"
    });
    await expect(getBlastSearchInfo("RID123", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch)).rejects.toMatchObject({
      code: "failed_network"
    });
  });

  it("times out stalled requests", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );

    const pending = submitBlastRequest(state, fetcher as typeof fetch);
    const expectation = expect(pending).rejects.toMatchObject({ code: "failed_timeout" });
    await vi.advanceTimersByTimeAsync(30000);
    await expectation;
  });

  it("enforces minimum 60 second polling delay", () => {
    expect(nextPollDelayMs(30)).toBe(60000);
    expect(nextPollDelayMs(60)).toBe(60000);
    expect(nextPollDelayMs(90)).toBe(90000);
    expect(nextPollDelayMs()).toBe(60000);
  });
});
