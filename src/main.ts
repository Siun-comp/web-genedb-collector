import "./styles.css";
import { APP_NAME, BLAST_DEFAULTS, FILTER_DEFAULTS } from "./config/defaults";
import { parseBlastResultSkeleton, type BlastParseResult } from "./domain/blastResultParser";
import { buildCollectionStatus } from "./domain/status";
import { summarizeSequence } from "./domain/fasta";
import { parseKeywords } from "./domain/filters";
import { buildGeneDbOutputBundle, safeTaskName, type GeneDbOutputBundle, type OutputContext } from "./domain/outputs";
import type { CollectionFormState, JobStatus, ValidationMessage } from "./domain/types";
import { validateCollectionForm } from "./domain/validation";
import {
  BlastClientError,
  buildSafeBlastRequestPreview,
  downloadBlastResultWithFallback,
  getBlastSearchInfo,
  nextPollDelayMs,
  submitBlastRequest,
  type BlastSearchStatus
} from "./services/blastClient";
import {
  buildJobSnapshot,
  clearJobSnapshot,
  deleteJobSnapshot,
  loadJobSnapshot,
  restoreCollectionState,
  saveJobSnapshot,
  type PersistedJobSnapshot,
  type StoredQuerySummary
} from "./services/storage";
import { buildZipManifest, createGeneDbZip, downloadBlob } from "./services/zipWriter";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

const appRoot = app;

const initialState: CollectionFormState = {
  taskName: "Monkeypox_Target_Collection",
  referenceSequence: "",
  taxid: "10244",
  database: BLAST_DEFAULTS.database,
  task: BLAST_DEFAULTS.task,
  maxHits: BLAST_DEFAULTS.maxHits,
  expect: BLAST_DEFAULTS.expect,
  wordSize: BLAST_DEFAULTS.wordSize,
  tool: BLAST_DEFAULTS.tool,
  email: BLAST_DEFAULTS.email,
  lengthFilterEnabled: FILTER_DEFAULTS.lengthFilterEnabled,
  minLengthPercent: FILTER_DEFAULTS.minLengthPercent,
  maxLengthPercent: FILTER_DEFAULTS.maxLengthPercent,
  keywordFilterEnabled: FILTER_DEFAULTS.keywordFilterEnabled,
  keywords: FILTER_DEFAULTS.keywords.join(", "),
  excludeAmbiguousN: FILTER_DEFAULTS.excludeAmbiguousN
};

interface RuntimeJob {
  status: JobStatus;
  rid?: string;
  rtoeSeconds?: number;
  lastSearchStatus?: BlastSearchStatus;
  lastCheckedAt?: number;
  nextPollAt?: number;
  isBusy: boolean;
  title: string;
  detail: string;
  action: string;
  logs: string[];
  parseResult?: BlastParseResult;
  outputBundle?: GeneDbOutputBundle;
  resultFormat?: string;
  resultDownloadedAt?: number;
  resultRawLength?: number;
  restoredQuery?: StoredQuerySummary;
  restoredAt?: string;
  storageMessage?: string;
}

let state = { ...initialState };
let pollTimer: number | undefined;
let job: RuntimeJob = idleJob();
let restoredSnapshot: PersistedJobSnapshot | null = null;

function render(focusToRestore?: { id: string; start: number | null; end: number | null }): void {
  const sequence = summarizeSequence(state.referenceSequence);
  const validation = validateCollectionForm(state);
  const validationStatus = buildCollectionStatus(validation);
  const zipManifest = buildZipManifest(state.taskName);
  const requestPreview = buildSafeBlastRequestPreview(state);
  const outputPreview = buildOutputPreview();
  const displayedStatus = validation.canSubmit || job.rid ? job : validationToJob(validationStatus.status, validationStatus.title, validationStatus.detail, validationStatus.nextAction);

  appRoot.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <h1>${APP_NAME}</h1>
          <p>입력한 DNA sequence를 지정 taxid 안에서 BLAST하여 aligned hit FASTA를 수집하기 위한 정적 웹앱입니다.</p>
        </div>
        <div class="phase-badge">Phase 5 · IndexedDB recovery</div>
      </header>

      <section class="notice-strip">
        <strong>중요:</strong> NCBI BLAST 제출 버튼을 누르면 입력한 target/reference DNA sequence가 NCBI BLAST URL API로 전송됩니다. 화면과 상태 로그에는 전체 sequence를 표시하지 않고 length/hash/masked preview만 표시합니다.
      </section>

      <section class="notice-strip muted">
        브라우저 복구 정보는 작업 RID와 조건을 다시 찾기 위한 임시 기록입니다. 최종 보관본은 다운로드한 ZIP 파일입니다. 복구 정보에는 입력 DNA 전체 서열이나 BLAST 원문 결과를 저장하지 않습니다.
      </section>

      <section class="workspace">
        <section class="panel">
          <div class="section-heading">
            <h2>1. Target 입력</h2>
            <span class="section-note">FASTA header는 자동 제외하고 염기서열만 정리합니다.</span>
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="taskName">Task name</label>
              <input id="taskName" value="${escapeHtml(state.taskName)}" autocomplete="off" />
              <div class="hint">ZIP/FASTA 파일명에 사용됩니다. 현재 prefix: <code>${escapeHtml(safeTaskName(state.taskName))}</code></div>
            </div>
            <div class="field">
              <label for="taxid">NCBI Taxonomy ID</label>
              <input id="taxid" inputmode="numeric" value="${escapeHtml(state.taxid)}" autocomplete="off" />
              <div class="hint">Organism name이 아니라 숫자 taxid만 입력합니다. 예: <code>10244</code></div>
            </div>
            <div class="field full">
              <label for="referenceSequence">Target / reference DNA sequence</label>
              <textarea id="referenceSequence" placeholder="FASTA 또는 raw DNA sequence를 붙여 넣으세요. 실제 분석 sequence는 repository에 저장하지 않습니다.">${escapeHtml(
                state.referenceSequence
              )}</textarea>
              <div class="hint">이 값은 버튼을 누를 때 NCBI로 전송됩니다. public repository에는 저장하지 마세요.</div>
            </div>
          </div>

          <div class="summary-grid wide">
            ${metric("정리된 길이", `${sequence.cleanedLength.toLocaleString()} bp`)}
            ${metric("GC", sequence.gcPercent === null ? "-" : `${sequence.gcPercent}%`)}
            ${metric("N", sequence.nCount.toLocaleString())}
            ${metric("IUPAC ambiguity", sequence.ambiguousIupacCount.toLocaleString())}
          </div>

          <div class="advanced">
            <div class="section-heading">
              <h2>2. BLAST 수집 조건</h2>
              <span class="section-note">NCBI URL API에 보낼 값입니다.</span>
            </div>
            <div class="form-grid">
              <div class="field">
                <label for="maxHits">Max hits</label>
                <input id="maxHits" type="number" min="1" max="${BLAST_DEFAULTS.maxHitsLimit}" value="${state.maxHits}" />
                <div class="hint">기본값 20000, 최대 입력값 100000. 요청값이며 보장값은 아닙니다.</div>
              </div>
              <div class="field">
                <label for="database">Database</label>
                <select id="database">
                  ${option("core_nt", state.database)}
                  ${option("nt", state.database)}
                  ${option("refseq_rna", state.database)}
                  ${option("refseq_genomic", state.database)}
                </select>
              </div>
              <div class="field">
                <label for="task">BLAST mode</label>
                <select id="task">
                  ${option("megablast", state.task)}
                  ${option("blastn", state.task)}
                  ${option("dc-megablast", state.task)}
                </select>
              </div>
              <div class="field">
                <label for="expect">Expect</label>
                <input id="expect" type="number" step="0.01" value="${state.expect}" />
              </div>
              <div class="field">
                <label for="wordSize">Word size</label>
                <input id="wordSize" type="number" min="1" value="${state.wordSize}" />
              </div>
              <div class="field">
                <label for="email">Email optional</label>
                <input id="email" value="${escapeHtml(state.email)}" placeholder="비워 둘 수 있음" autocomplete="off" />
                <div class="hint">repository에 저장하지 않습니다. 입력값으로만 사용됩니다.</div>
              </div>
              <div class="field">
                <label for="tool">Tool</label>
                <input id="tool" value="${escapeHtml(state.tool)}" autocomplete="off" />
              </div>
            </div>
          </div>

          <div class="advanced">
            <div class="section-heading">
              <h2>3. 저장 전 필터</h2>
              <span class="section-note">FASTA/ZIP 생성 전에 적용할 조건입니다.</span>
            </div>
            <div class="form-grid">
              <label class="checkbox-row">
                <input id="lengthFilterEnabled" type="checkbox" ${state.lengthFilterEnabled ? "checked" : ""} />
                Length filter 사용
              </label>
              <label class="checkbox-row">
                <input id="keywordFilterEnabled" type="checkbox" ${state.keywordFilterEnabled ? "checked" : ""} />
                Keyword exclude 사용
              </label>
              <div class="field">
                <label for="minLengthPercent">Min length %</label>
                <input id="minLengthPercent" type="number" value="${state.minLengthPercent}" />
              </div>
              <div class="field">
                <label for="maxLengthPercent">Max length %</label>
                <input id="maxLengthPercent" type="number" value="${state.maxLengthPercent}" />
              </div>
              <div class="field full">
                <label for="keywords">Exclude keywords</label>
                <input id="keywords" value="${escapeHtml(state.keywords)}" autocomplete="off" />
              </div>
              <label class="checkbox-row">
                <input id="excludeAmbiguousN" type="checkbox" ${state.excludeAmbiguousN ? "checked" : ""} />
                N 포함 hit를 별도 제외 파일로 분리
              </label>
            </div>
          </div>

          <div class="actions">
            <button class="primary-button" id="submitBlast" ${validation.canSubmit && !job.isBusy ? "" : "disabled"}>NCBI BLAST 제출</button>
            <button class="secondary-button" id="pollNow" ${canManualPoll() ? "" : "disabled"}>SearchInfo 확인</button>
            <button class="secondary-button" id="stopPolling" ${job.rid && job.status === "waiting" ? "" : "disabled"}>Polling 중단</button>
            <button class="primary-button" id="downloadZip" ${job.outputBundle && !job.isBusy ? "" : "disabled"}>ZIP 다운로드</button>
            <button class="secondary-button" id="clearRecovery" ${restoredSnapshot || job.rid ? "" : "disabled"}>복구 정보 삭제</button>
            <button class="secondary-button" id="resetForm">기본값 복원</button>
          </div>
        </section>

        <aside class="status-panel">
          <section class="panel status-card ${statusClass(displayedStatus.status)}">
            <h2>${escapeHtml(displayedStatus.title)}</h2>
            <p>${escapeHtml(displayedStatus.detail)}</p>
            <div class="status-next">${escapeHtml(displayedStatus.action)}</div>
          </section>

          <section class="panel">
            <h2>검증 결과</h2>
            ${renderValidationMessages(validation.messages)}
          </section>

          <section class="panel">
            <h2>RID / SearchInfo</h2>
            <div class="status-box">
              ${statusLine("RID", job.rid ?? "아직 없음")}
              ${statusLine("RTOE", job.rtoeSeconds === undefined ? "-" : `${job.rtoeSeconds} sec`)}
              ${statusLine("SearchInfo", job.lastSearchStatus ?? "-")}
              ${statusLine("Last checked", job.lastCheckedAt ? formatTime(job.lastCheckedAt) : "-")}
              ${statusLine("Next allowed poll", job.nextPollAt ? `${formatTime(job.nextPollAt)} (${formatRemaining(job.nextPollAt)})` : "-")}
              ${statusLine("Result format", job.resultFormat ?? "-")}
              ${statusLine("Result downloaded", job.resultDownloadedAt ? formatTime(job.resultDownloadedAt) : "-")}
              ${statusLine("Result response length", job.resultRawLength === undefined ? "-" : `${job.resultRawLength.toLocaleString()} chars`)}
            </div>
          </section>

          <section class="panel">
            <h2>작업 복구</h2>
            ${renderRecoveryPanel()}
          </section>

          <section class="panel">
            <h2>Parser skeleton</h2>
            ${renderParseResult(job.parseResult)}
          </section>

          <section class="panel">
            <h2>FASTA / ZIP 결과</h2>
            ${renderOutputBundle(job.outputBundle)}
          </section>

          <section class="panel">
            <h2>NCBI 요청 safe preview</h2>
            <div class="status-box">
              ${statusLine("Method", requestPreview.method)}
              ${statusLine("URL", requestPreview.url)}
              ${statusLine("PROGRAM", requestPreview.params.PROGRAM)}
              ${statusLine("DATABASE", requestPreview.params.DATABASE)}
              ${statusLine("TASK", requestPreview.params.TASK)}
              ${statusLine("HITLIST_SIZE", requestPreview.params.HITLIST_SIZE)}
              ${statusLine("EXPECT", requestPreview.params.EXPECT)}
              ${statusLine("WORD_SIZE", requestPreview.params.WORD_SIZE)}
              ${statusLine("ENTREZ_QUERY", requestPreview.params.ENTREZ_QUERY || "taxid 필요")}
              ${statusLine("QUERY length", `${requestPreview.query.length.toLocaleString()} bp`)}
              ${statusLine("QUERY hash", requestPreview.query.hash)}
              ${statusLine("QUERY preview", requestPreview.query.maskedPreview || "서열 없음")}
            </div>
          </section>

          <section class="panel">
            <h2>Output preview</h2>
            <div class="status-box">
              ${statusLine("FASTA header", outputPreview.header)}
              ${statusLine("Length filter", outputPreview.lengthFilter)}
              ${statusLine("Keyword filter", outputPreview.keywordFilter)}
              ${statusLine("N filter", outputPreview.nFilter)}
            </div>
            <ul class="file-list">
              ${zipManifest.files.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}
            </ul>
          </section>

          <section class="panel">
            <h2>Process log</h2>
            ${renderLog(job.logs)}
          </section>

          <section class="panel">
            <h2>Phase 진행 상태</h2>
            <ol class="step-list">
              ${step("입력 검증", validation.canSubmit)}
              ${step("NCBI submit / RID 발급", Boolean(job.rid))}
              ${step("RID SearchInfo polling", job.status === "waiting" || job.status === "ready" || job.status === "no_hits" || job.status === "downloading" || job.status === "parsing" || job.status === "generatingZip" || job.status === "done")}
              ${step("BLAST result download", Boolean(job.parseResult))}
              ${step("Parser skeleton", Boolean(job.parseResult))}
              ${step("FASTA / ZIP 생성", Boolean(job.outputBundle))}
            </ol>
          </section>
        </aside>
      </section>
    </div>
  `;

  bindEvents();
  restoreFocus(focusToRestore);
}

function bindEvents(): void {
  bindInput("taskName", (value) => (state.taskName = value));
  bindInput("taxid", (value) => (state.taxid = value.replace(/\D/g, "")));
  bindInput("referenceSequence", (value) => (state.referenceSequence = value));
  bindInput("database", (value) => (state.database = value));
  bindInput("task", (value) => (state.task = value as CollectionFormState["task"]));
  bindInput("maxHits", (value) => (state.maxHits = parseInteger(value, BLAST_DEFAULTS.maxHits)));
  bindInput("expect", (value) => (state.expect = parseFloatNumber(value, BLAST_DEFAULTS.expect)));
  bindInput("wordSize", (value) => (state.wordSize = parseInteger(value, BLAST_DEFAULTS.wordSize)));
  bindInput("email", (value) => (state.email = value));
  bindInput("tool", (value) => (state.tool = value));
  bindCheckbox("lengthFilterEnabled", (checked) => (state.lengthFilterEnabled = checked));
  bindCheckbox("keywordFilterEnabled", (checked) => (state.keywordFilterEnabled = checked));
  bindInput("minLengthPercent", (value) => (state.minLengthPercent = parseFloatNumber(value, FILTER_DEFAULTS.minLengthPercent)));
  bindInput("maxLengthPercent", (value) => (state.maxLengthPercent = parseFloatNumber(value, FILTER_DEFAULTS.maxLengthPercent)));
  bindInput("keywords", (value) => (state.keywords = value));
  bindCheckbox("excludeAmbiguousN", (checked) => (state.excludeAmbiguousN = checked));

  document.querySelector("#submitBlast")?.addEventListener("click", () => {
    void handleSubmit();
  });
  document.querySelector("#pollNow")?.addEventListener("click", () => {
    void pollSearchInfo(true);
  });
  document.querySelector("#stopPolling")?.addEventListener("click", () => {
    stopPolling("사용자가 자동 polling을 중단했습니다. RID는 유지됩니다.");
  });
  document.querySelector("#downloadZip")?.addEventListener("click", () => {
    void handleDownloadZip();
  });
  document.querySelector("#clearRecovery")?.addEventListener("click", () => {
    void handleClearRecovery();
  });
  document.querySelector("#resetForm")?.addEventListener("click", () => {
    clearPollTimer();
    state = { ...initialState };
    job = idleJob();
    restoredSnapshot = null;
    void clearJobSnapshot();
    render();
  });
}

async function handleSubmit(): Promise<void> {
  const validation = validateCollectionForm(state);
  if (!validation.canSubmit || job.isBusy) {
    return;
  }

  clearPollTimer();
  const safePreview = buildSafeBlastRequestPreview(state);
  job = {
    ...job,
    status: "submitting",
    isBusy: true,
    title: "NCBI BLAST 제출 중",
    detail: "CMD=Put 요청을 NCBI BLAST URL API로 보내고 있습니다.",
    action: "브라우저를 닫지 말고 기다리세요.",
    logs: appendLog(job.logs, `Submit started. query=${safePreview.query.hash}, length=${safePreview.query.length} bp, taxid=${state.taxid.trim()}, maxHits=${state.maxHits}`)
  };
  render();

  try {
    const result = await submitBlastRequest(state);
    const now = Date.now();
    const nextPollAt = now + nextPollDelayMs(result.rtoeSeconds);
    job = {
      status: "waiting",
      rid: result.rid,
      rtoeSeconds: result.rtoeSeconds,
      lastSearchStatus: "WAITING",
      lastCheckedAt: undefined,
      nextPollAt,
      isBusy: false,
      title: "RID 발급 완료",
      detail: `RID ${result.rid}가 발급되었습니다. NCBI 권장 간격에 맞춰 SearchInfo를 확인합니다.`,
      action: "같은 RID는 최소 60초보다 자주 확인하지 않습니다.",
      logs: appendLog(job.logs, `RID issued. rid=${result.rid}, rtoe=${result.rtoeSeconds}s, responseLength=${result.rawLength}`)
    };
    persistSnapshot();
    scheduleNextPoll();
  } catch (error) {
    job = errorJob(error, job.logs);
    persistSnapshot();
  }
  render();
}

async function pollSearchInfo(manual: boolean): Promise<void> {
  if (!job.rid || job.isBusy) return;
  const rid = job.rid;

  const now = Date.now();
  if (manual && job.nextPollAt && now < job.nextPollAt) {
    job = {
      ...job,
      logs: appendLog(job.logs, `Polling skipped. nextAllowed=${new Date(job.nextPollAt).toISOString()}`),
      action: `아직 polling 가능 시간이 아닙니다. ${formatRemaining(job.nextPollAt)} 후 다시 확인하세요.`
    };
    render();
    return;
  }

  clearPollTimer();
  job = {
    ...job,
    status: "waiting",
    isBusy: true,
    title: "SearchInfo 확인 중",
    detail: "NCBI에서 RID 처리 상태를 확인하고 있습니다.",
    action: "READY가 되면 result download, parser, FASTA/ZIP 준비로 이어집니다."
  };
  render();

  try {
    const result = await getBlastSearchInfo(rid);
    applySearchInfo(result.status, result.checkedAt, result.rawLength);
    persistSnapshot();
  } catch (error) {
    job = errorJob(error, job.logs);
    persistSnapshot();
  }
  render();
}

function applySearchInfo(status: BlastSearchStatus, checkedAtIso: string, responseLength: number): void {
  const checkedAt = Date.parse(checkedAtIso);
  const logs = appendLog(job.logs, `SearchInfo ${status}. checkedAt=${checkedAtIso}, responseLength=${responseLength}`);

  if (status === "WAITING") {
    job = {
      ...job,
      status: "waiting",
      lastSearchStatus: status,
      lastCheckedAt: checkedAt,
      nextPollAt: checkedAt + nextPollDelayMs(),
      isBusy: false,
      title: "NCBI 처리 중",
      detail: "NCBI BLAST 작업이 아직 WAITING 상태입니다.",
      action: "최소 60초 후 같은 RID를 다시 확인합니다.",
      logs
    };
    scheduleNextPoll();
    return;
  }

  if (status === "READY") {
    job = {
      ...job,
      status: "ready",
      lastSearchStatus: status,
      lastCheckedAt: checkedAt,
      nextPollAt: undefined,
      isBusy: false,
      title: "BLAST 결과 준비 완료",
      detail: "SearchInfo가 READY + hits 상태를 반환했습니다. BLAST result 다운로드를 시작합니다.",
      action: "raw BLAST result와 전체 query sequence는 화면/로그에 표시하지 않습니다.",
      logs
    };
    window.setTimeout(() => {
      void downloadReadyResult();
    }, 0);
    return;
  }

  if (status === "NO_HITS") {
    job = {
      ...job,
      status: "no_hits",
      lastSearchStatus: status,
      lastCheckedAt: checkedAt,
      nextPollAt: undefined,
      isBusy: false,
      title: "Hit 없음",
      detail: "실행은 완료됐지만 NCBI가 해당 조건에서 hit 없음 상태를 반환했습니다.",
      action: "taxid, target sequence, expect, max hits 조건을 확인하세요.",
      logs
    };
    return;
  }

  job = {
    ...job,
    status: status === "FAILED" ? "failed_ncbi" : "failed_unknown_rid",
    lastSearchStatus: status,
    lastCheckedAt: checkedAt,
    nextPollAt: undefined,
    isBusy: false,
    title: status === "FAILED" ? "NCBI 작업 실패" : "RID 확인 불가",
    detail: status === "FAILED" ? "NCBI가 RID 작업 실패 상태를 반환했습니다." : "NCBI가 RID를 찾을 수 없거나 만료된 상태를 반환했습니다.",
    action: "같은 조건으로 새 RID를 다시 발급해야 할 수 있습니다.",
    logs
  };
}

async function downloadReadyResult(): Promise<void> {
  if (!job.rid || job.isBusy || job.status !== "ready") return;
  const rid = job.rid;

  job = {
    ...job,
    status: "downloading",
    isBusy: true,
    title: "BLAST result download",
    detail: "NCBI에서 JSON2_S result를 우선 다운로드하고, 실패하면 XML result를 시도합니다.",
    action: "The raw BLAST result is not shown in the UI or process log."
  };
  render();

  try {
    const result = await downloadBlastResultWithFallback(rid);
    const parseResult = parseBlastResultSkeleton(result.text, result.format);
    const resultDownloadedAt = Date.parse(result.downloadedAt);
    const outputBundle = buildGeneDbOutputBundle(state, parseResult, {
      rid,
      resultFormat: result.format,
      resultDownloadedAt,
      resultRawLength: result.rawLength,
      processLogs: job.logs
    });
    job = {
      ...job,
      status: "done",
      isBusy: false,
      parseResult,
      outputBundle,
      resultFormat: result.format,
      resultDownloadedAt,
      resultRawLength: result.rawLength,
      title: "FASTA / ZIP 준비 완료",
      detail: `Aligned=${outputBundle.summary.savedCount}, N 분리=${outputBundle.summary.ambiguousCount}, 제외=${outputBundle.summary.droppedCount}.`,
      action: "결과를 확인한 뒤 ZIP 다운로드를 누르세요.",
      logs: appendLog(
        job.logs,
        `Result downloaded and output prepared. rid=${rid}, format=${result.format}, responseLength=${result.rawLength}, aligned=${outputBundle.summary.savedCount}, ambiguous=${outputBundle.summary.ambiguousCount}, dropped=${outputBundle.summary.droppedCount}`
      )
    };
    persistSnapshot();
  } catch (error) {
    job = errorJob(error, job.logs);
    persistSnapshot();
  }
  render();
}

async function handleDownloadZip(): Promise<void> {
  if (!job.outputBundle || !job.parseResult || job.isBusy) return;
  const bundle = buildGeneDbOutputBundle(state, job.parseResult, outputContext());
  const fileName = `${safeTaskName(state.taskName)}.zip`;
  job = {
    ...job,
    status: "generatingZip",
    isBusy: true,
    outputBundle: bundle,
    title: "ZIP 생성 중",
    detail: "Aligned FASTA, ambiguous FASTA, meta.json, run_info.json, process.log를 ZIP으로 묶고 있습니다.",
    action: "브라우저 다운로드가 시작될 때까지 기다리세요."
  };
  render();

  try {
    const blob = await createGeneDbZip(bundle);
    downloadBlob(blob, fileName);
    job = {
      ...job,
      status: "done",
      isBusy: false,
      title: "ZIP 다운로드 시작",
      detail: `${fileName} 다운로드를 시작했습니다.`,
      action: "다운로드 폴더에서 ZIP 파일을 확인하세요.",
      logs: appendLog(job.logs, `ZIP generated. file=${fileName}, bytes=${blob.size}`)
    };
    persistSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 ZIP 생성 오류가 발생했습니다.";
    job = {
      ...job,
      status: "failed_zip",
      isBusy: false,
      title: "ZIP 생성 실패",
      detail: message,
      action: "브라우저 메모리 또는 다운로드 권한을 확인하고 hit 수를 낮춰 다시 시도하세요.",
      logs: appendLog(job.logs, `Error failed_zip: ${message}`)
    };
    persistSnapshot();
  }
  render();
}

function scheduleNextPoll(): void {
  clearPollTimer();
  if (!job.rid || job.status !== "waiting" || !job.nextPollAt) return;
  const delay = Math.max(0, job.nextPollAt - Date.now());
  pollTimer = window.setTimeout(() => {
    void pollSearchInfo(false);
  }, delay);
}

function stopPolling(message: string): void {
  clearPollTimer();
  job = {
    ...job,
    isBusy: false,
    nextPollAt: undefined,
    action: message,
    logs: appendLog(job.logs, message)
  };
  persistSnapshot();
  render();
}

function clearPollTimer(): void {
  if (pollTimer !== undefined) {
    window.clearTimeout(pollTimer);
    pollTimer = undefined;
  }
}

function refreshOutputBundle(): void {
  if (!job.parseResult) return;
  job = {
    ...job,
    outputBundle: buildGeneDbOutputBundle(state, job.parseResult, outputContext())
  };
}

function outputContext(): OutputContext {
  return {
    rid: job.rid,
    resultFormat: job.resultFormat,
    resultDownloadedAt: job.resultDownloadedAt,
    resultRawLength: job.resultRawLength,
    queryLength: job.restoredQuery?.length,
    queryHash: job.restoredQuery?.hash,
    processLogs: job.logs
  };
}

async function initializeApp(): Promise<void> {
  try {
    const snapshot = await loadJobSnapshot();
    if (snapshot) {
      restoredSnapshot = snapshot;
      state = restoreCollectionState(snapshot);
      job = jobFromSnapshot(snapshot);
    }
  } catch {
    job = {
      ...job,
      storageMessage: "브라우저 복구 정보를 읽지 못했습니다. 새 작업은 계속 진행할 수 있습니다."
    };
  }
  render();
}

function jobFromSnapshot(snapshot: PersistedJobSnapshot): RuntimeJob {
  return {
    status: snapshot.status === "submitting" || snapshot.status === "downloading" || snapshot.status === "generatingZip" ? "waiting" : snapshot.status,
    rid: snapshot.rid,
    rtoeSeconds: snapshot.rtoeSeconds,
    lastSearchStatus: snapshot.lastSearchStatus,
    lastCheckedAt: snapshot.lastCheckedAt,
    nextPollAt: snapshot.nextPollAt,
    isBusy: false,
    title: snapshot.rid ? "복구된 RID 작업" : "복구 정보 있음",
    detail: snapshot.rid
      ? "브라우저에 저장된 RID와 조건을 복구했습니다. 입력 DNA 원문은 저장하지 않았으므로 ZIP 재생성은 RID 재조회 후 다시 수행합니다."
      : "복구 가능한 RID가 없습니다.",
    action: snapshot.rid ? "SearchInfo 확인 버튼으로 같은 RID를 다시 조회할 수 있습니다." : "새 작업을 제출하세요.",
    logs: snapshot.logs,
    resultFormat: snapshot.result?.resultFormat,
    resultDownloadedAt: snapshot.result?.resultDownloadedAt,
    resultRawLength: snapshot.result?.resultRawLength,
    restoredQuery: snapshot.query,
    restoredAt: snapshot.updatedAt,
    storageMessage: "마지막 작업 복구 정보를 불러왔습니다. 최종 보관본은 다운로드한 ZIP 파일입니다."
  };
}

function persistSnapshot(): void {
  if (!job.rid) return;
  const snapshot = buildJobSnapshot(state, {
    status: job.status,
    rid: job.rid,
    rtoeSeconds: job.rtoeSeconds,
    lastSearchStatus: job.lastSearchStatus,
    lastCheckedAt: job.lastCheckedAt,
    nextPollAt: job.nextPollAt,
    resultFormat: job.resultFormat,
    resultDownloadedAt: job.resultDownloadedAt,
    resultRawLength: job.resultRawLength,
    outputSummary: job.outputBundle?.summary,
    parserDroppedCount: job.outputBundle?.parserDroppedCount,
    logs: job.logs
  }, restoredSnapshot);
  restoredSnapshot = snapshot;
  job = {
    ...job,
    restoredQuery: snapshot.query,
    restoredAt: snapshot.updatedAt,
    storageMessage: "복구 정보가 브라우저에 저장되었습니다."
  };
  void saveJobSnapshot(snapshot).catch(() => {
    job = {
      ...job,
      storageMessage: "복구 정보 저장에 실패했습니다. 작업 진행은 계속할 수 있습니다."
    };
    render();
  });
}

async function handleClearRecovery(): Promise<void> {
  clearPollTimer();
  const id = restoredSnapshot?.id;
  try {
    if (id) {
      await deleteJobSnapshot(id);
    } else {
      await clearJobSnapshot();
    }
  } catch {
    job = {
      ...job,
      storageMessage: "복구 정보 삭제에 실패했습니다."
    };
    render();
    return;
  }
  restoredSnapshot = null;
  job = {
    ...job,
    restoredAt: undefined,
    restoredQuery: undefined,
    storageMessage: "복구 정보를 삭제했습니다. 현재 화면의 작업은 유지됩니다."
  };
  render();
}

function canManualPoll(): boolean {
  return Boolean(job.rid && !job.isBusy && (!job.nextPollAt || Date.now() >= job.nextPollAt));
}

function errorJob(error: unknown, previousLogs: string[]): RuntimeJob {
  const code = error instanceof BlastClientError ? error.code : "failed_network";
  const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
  return {
    ...job,
    status: code,
    isBusy: false,
    nextPollAt: undefined,
    title: errorTitle(code),
    detail: message,
    action: errorAction(code),
    logs: appendLog(previousLogs, `Error ${code}: ${message}`)
  };
}

function idleJob(): RuntimeJob {
  return {
    status: "idle",
    isBusy: false,
    title: "제출 대기",
    detail: "입력 검증을 통과하면 NCBI BLAST 제출을 시작할 수 있습니다.",
    action: "실제 submit 전 sequence, taxid, max hits를 확인하세요.",
    logs: []
  };
}

function validationToJob(status: JobStatus, title: string, detail: string, action: string): RuntimeJob {
  return {
    ...idleJob(),
    status,
    title,
    detail,
    action
  };
}

function bindInput(id: string, update: (value: string) => void): void {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`);
  element?.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const focusToRestore = {
      id,
      start: "selectionStart" in target ? target.selectionStart : null,
      end: "selectionEnd" in target ? target.selectionEnd : null
    };
    update(target.value);
    refreshOutputBundle();
    persistSnapshot();
    render(focusToRestore);
  });
}

function bindCheckbox(id: string, update: (checked: boolean) => void): void {
  const element = document.querySelector<HTMLInputElement>(`#${id}`);
  element?.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    update(target.checked);
    refreshOutputBundle();
    persistSnapshot();
    render();
  });
}

function restoreFocus(focusToRestore?: { id: string; start: number | null; end: number | null }): void {
  if (!focusToRestore) return;
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${focusToRestore.id}`);
  if (!element) return;
  element.focus();
  if ("setSelectionRange" in element && focusToRestore.start !== null && focusToRestore.end !== null) {
    element.setSelectionRange(focusToRestore.start, focusToRestore.end);
  }
}

function buildOutputPreview(): { header: string; lengthFilter: string; keywordFilter: string; nFilter: string } {
  return {
    header: ">description_accession 중심, 상세 provenance는 meta.json",
    lengthFilter: state.lengthFilterEnabled ? `${state.minLengthPercent}%~${state.maxLengthPercent}%` : "사용 안 함",
    keywordFilter: state.keywordFilterEnabled ? parseKeywords(state.keywords).join(", ") || "keyword 없음" : "사용 안 함",
    nFilter: state.excludeAmbiguousN ? "N 포함 hit는 excluded_ambiguous FASTA로 분리" : "N 포함 hit도 aligned FASTA에 포함"
  };
}

function renderValidationMessages(messages: ValidationMessage[]): string {
  if (messages.length === 0) {
    return `<div class="empty-state">필수 입력과 기본 조건이 모두 유효합니다.</div>`;
  }
  return `<div class="message-list">${messages.map(renderValidationMessage).join("")}</div>`;
}

function renderValidationMessage(message: ValidationMessage): string {
  return `
    <div class="message-item ${message.severity}">
      <strong>${escapeHtml(severityLabel(message.severity))}: ${escapeHtml(message.message)}</strong>
      <span>${escapeHtml(message.action)}</span>
    </div>
  `;
}

function renderLog(logs: string[]): string {
  if (logs.length === 0) {
    return `<div class="empty-state">아직 NCBI 제출 기록이 없습니다.</div>`;
  }
    return `<ol class="process-log">${logs.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>`;
}

function renderParseResult(parseResult?: BlastParseResult): string {
  if (!parseResult) {
    return `<div class="empty-state">SearchInfo가 READY + hits 상태가 되면 BLAST result 구조 요약이 표시됩니다.</div>`;
  }

  const firstRecord = parseResult.records[0];
  const firstRecordLines = firstRecord
    ? `
      ${statusLine("First accession", firstRecord.accession)}
      ${statusLine("First title", firstRecord.title)}
      ${statusLine("First HSP length", `${firstRecord.sequence.length.toLocaleString()} bp`)}
      ${statusLine("First HSP source", firstRecord.sequenceSource)}
    `
    : statusLine("First HSP", "저장 가능한 HSP sequence 없음");

  return `
    <div class="status-box">
      ${statusLine("Format", parseResult.format)}
      ${statusLine("Parsed records", parseResult.records.length.toLocaleString())}
      ${statusLine("Dropped hits", parseResult.dropped.length.toLocaleString())}
      ${statusLine("Unique sequences", parseResult.summary.uniqueCount.toLocaleString())}
      ${statusLine("Length range", `${parseResult.summary.minLength.toLocaleString()}-${parseResult.summary.maxLength.toLocaleString()} bp`)}
      ${firstRecordLines}
    </div>
  `;
}

function renderOutputBundle(bundle?: GeneDbOutputBundle): string {
  if (!bundle) {
    return `<div class="empty-state">BLAST result parser가 완료되면 FASTA/ZIP count가 표시됩니다.</div>`;
  }

  return `
    <div class="status-box">
      ${statusLine("BLAST hit / usable HSP", `${bundle.records.length.toLocaleString()} usable HSP`)}
      ${statusLine("Aligned FASTA 저장", `${bundle.summary.savedCount.toLocaleString()} records`)}
      ${statusLine("N 포함 분리", `${bundle.summary.ambiguousCount.toLocaleString()} records`)}
      ${statusLine("Length 제외", `${bundle.summary.lengthDroppedCount.toLocaleString()} records`)}
      ${statusLine("Keyword 제외", `${bundle.summary.keywordDroppedCount.toLocaleString()} records`)}
      ${statusLine("Parser 제외", `${bundle.parserDroppedCount.toLocaleString()} records`)}
      ${statusLine("전체 제외", `${bundle.summary.droppedCount.toLocaleString()} records`)}
      ${statusLine("Unique sequence 참고값", `${bundle.summary.uniqueCount.toLocaleString()} (dedup output 아님)`)}
      ${statusLine("Aligned 길이 범위", `${bundle.summary.minLength.toLocaleString()}-${bundle.summary.maxLength.toLocaleString()} bp`)}
    </div>
  `;
}

function renderRecoveryPanel(): string {
  if (!restoredSnapshot && !job.rid) {
    return `<div class="empty-state">복구 가능한 RID 작업이 아직 없습니다. RID가 발급되면 브라우저에 안전 요약 정보가 임시 저장됩니다.</div>`;
  }

  const query = job.restoredQuery;
  const outputSummary = restoredSnapshot?.result?.outputSummary;
  return `
    <div class="status-box">
      ${statusLine("복구 상태", job.storageMessage ?? "복구 정보 없음")}
      ${statusLine("저장 시각", job.restoredAt ? new Date(job.restoredAt).toLocaleString() : "-")}
      ${statusLine("저장 RID", job.rid ?? "-")}
      ${statusLine("저장 query length", query ? `${query.length.toLocaleString()} bp` : "-")}
      ${statusLine("저장 query hash", query?.hash ?? "-")}
      ${statusLine("ZIP 재생성", job.parseResult ? "현재 화면에서 가능" : job.rid ? "RID 재조회 후 result download가 다시 성공하면 가능" : "불가")}
      ${statusLine("저장 count", outputSummary ? `aligned=${outputSummary.savedCount}, N=${outputSummary.ambiguousCount}, dropped=${outputSummary.droppedCount}` : "-")}
    </div>
  `;
}

function severityLabel(severity: ValidationMessage["severity"]): string {
  if (severity === "error") return "수정 필요";
  if (severity === "warning") return "확인 필요";
  return "정보";
}

function statusClass(status: JobStatus): string {
  if (status === "blocked_invalid_input" || status.startsWith("failed")) return "status-blocked";
  if (status === "ready" || status === "ready_to_submit" || status === "done") return "status-ready";
  if (status === "waiting" || status === "submitting" || status === "downloading" || status === "parsing" || status === "generatingZip") return "status-waiting";
  return "";
}

function errorTitle(code: JobStatus): string {
  if (code === "failed_cors") return "CORS 차단 가능성";
  if (code === "failed_network") return "네트워크 오류";
  if (code === "failed_ncbi") return "NCBI 응답 오류";
  if (code === "failed_parse") return "RID 파싱 실패";
  if (code === "failed_unknown_rid") return "RID 확인 실패";
  if (code === "failed_zip") return "ZIP 생성 실패";
  return "실패";
}

function errorAction(code: JobStatus): string {
  if (code === "failed_cors" || code === "failed_network") return "회사망 또는 브라우저에서 NCBI BLAST 접근이 가능한지 확인하세요.";
  if (code === "failed_parse") return "NCBI 응답 형식이 예상과 다릅니다. 잠시 후 다시 제출하세요.";
  if (code === "failed_zip") return "브라우저 메모리 또는 다운로드 권한을 확인하고 hit 수를 낮춰 다시 시도하세요.";
  return "조건을 확인한 뒤 새 RID를 다시 발급하세요.";
}

function appendLog(logs: string[], message: string): string[] {
  const timestamp = new Date().toISOString();
  return [`${timestamp} ${message}`, ...logs].slice(0, 20);
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function statusLine(label: string, value: string): string {
  return `<div class="status-line"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`;
}

function option(value: string, selected: string): string {
  return `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`;
}

function step(label: string, active: boolean): string {
  return `<li class="${active ? "active" : ""}">${escapeHtml(label)}</li>`;
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseFloatNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString();
}

function formatRemaining(value: number): string {
  const remainingSeconds = Math.max(0, Math.ceil((value - Date.now()) / 1000));
  return `${remainingSeconds}s`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

void initializeApp();
