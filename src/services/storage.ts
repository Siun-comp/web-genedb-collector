import { BLAST_DEFAULTS, FILTER_DEFAULTS } from "../config/defaults";
import { cleanSequence } from "../domain/fasta";
import { buildSafeBlastRequestPreview, type BlastSearchStatus } from "./blastClient";
import type { CollectionFormState, JobStatus, ParserSummary } from "../domain/types";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

const DB_NAME = "web-genedb-collector";
const DB_VERSION = 2;
const STORE_NAME = "jobSnapshots";
const LAST_JOB_KEY = "last-job";

export interface StoredCollectionState {
  taskName: string;
  taxid: string;
  database: string;
  task: CollectionFormState["task"];
  maxHits: number;
  expect: number;
  wordSize: number;
  tool: string;
  lengthFilterEnabled: boolean;
  minLengthPercent: number;
  maxLengthPercent: number;
  keywordFilterEnabled: boolean;
  keywords: string;
  excludeAmbiguousN: boolean;
}

export interface StoredQuerySummary {
  length: number;
  hash: string;
}

export interface StoredResultSummary {
  resultFormat?: string;
  resultDownloadedAt?: number;
  resultRawLength?: number;
  outputSummary?: ParserSummary;
  parserDroppedCount?: number;
}

export interface PersistedJobSnapshot {
  id: string;
  schemaVersion: 2;
  status: JobStatus;
  rid?: string;
  rtoeSeconds?: number;
  lastSearchStatus?: BlastSearchStatus;
  lastCheckedAt?: number;
  nextPollAt?: number;
  createdAt: string;
  updatedAt: string;
  state: StoredCollectionState;
  query: StoredQuerySummary;
  result?: StoredResultSummary;
  logs: string[];
}

export interface PersistableJobState {
  status: JobStatus;
  rid?: string;
  rtoeSeconds?: number;
  lastSearchStatus?: BlastSearchStatus;
  lastCheckedAt?: number;
  nextPollAt?: number;
  resultFormat?: string;
  resultDownloadedAt?: number;
  resultRawLength?: number;
  outputSummary?: ParserSummary;
  parserDroppedCount?: number;
  logs: string[];
}

interface GeneDbCollectorDb extends DBSchema {
  jobSnapshots: {
    key: string;
    value: PersistedJobSnapshot;
  };
}

let dbPromise: Promise<IDBPDatabase<GeneDbCollectorDb>> | null = null;

function getDb(): Promise<IDBPDatabase<GeneDbCollectorDb>> {
  dbPromise ??= openDB<GeneDbCollectorDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    }
  });
  return dbPromise;
}

export async function saveJobSnapshot(snapshot: PersistedJobSnapshot): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, snapshot, snapshot.id);
  await db.put(STORE_NAME, snapshot, LAST_JOB_KEY);
}

export async function loadJobSnapshot(): Promise<PersistedJobSnapshot | null> {
  const db = await getDb();
  const snapshot = await db.get(STORE_NAME, LAST_JOB_KEY);
  return isPersistedJobSnapshot(snapshot) ? snapshot : null;
}

export async function listJobSnapshots(): Promise<PersistedJobSnapshot[]> {
  const db = await getDb();
  const snapshots = await db.getAll(STORE_NAME);
  return uniqueSnapshots(snapshots)
    .filter(isPersistedJobSnapshot)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export async function deleteJobSnapshot(id: string): Promise<void> {
  const db = await getDb();
  const last = await loadJobSnapshot();
  await db.delete(STORE_NAME, id);
  if (last?.id === id) {
    await db.delete(STORE_NAME, LAST_JOB_KEY);
  }
}

export async function clearJobSnapshot(): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, LAST_JOB_KEY);
}

export function buildJobSnapshot(state: CollectionFormState, job: PersistableJobState, previous?: PersistedJobSnapshot | null): PersistedJobSnapshot {
  const safePreview = buildSafeBlastRequestPreview(state);
  const query = safePreview.query.length > 0 ? { length: safePreview.query.length, hash: safePreview.query.hash } : previous?.query ?? { length: 0, hash: safePreview.query.hash };
  const now = new Date().toISOString();
  return {
    id: previous?.id ?? `job-${Date.now()}`,
    schemaVersion: 2,
    status: job.status,
    rid: job.rid,
    rtoeSeconds: job.rtoeSeconds,
    lastSearchStatus: job.lastSearchStatus,
    lastCheckedAt: job.lastCheckedAt,
    nextPollAt: job.nextPollAt,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    state: sanitizeCollectionState(state),
    query,
    result:
      job.resultFormat || job.resultDownloadedAt || job.resultRawLength || job.outputSummary
        ? {
            resultFormat: job.resultFormat,
            resultDownloadedAt: job.resultDownloadedAt,
            resultRawLength: job.resultRawLength,
            outputSummary: job.outputSummary,
            parserDroppedCount: job.parserDroppedCount
          }
        : undefined,
    logs: sanitizeLogs(job.logs, state.referenceSequence)
  };
}

export function sanitizeCollectionState(state: CollectionFormState): StoredCollectionState {
  return {
    taskName: state.taskName,
    taxid: state.taxid,
    database: state.database,
    task: state.task,
    maxHits: state.maxHits,
    expect: state.expect,
    wordSize: state.wordSize,
    tool: state.tool,
    lengthFilterEnabled: state.lengthFilterEnabled,
    minLengthPercent: state.minLengthPercent,
    maxLengthPercent: state.maxLengthPercent,
    keywordFilterEnabled: state.keywordFilterEnabled,
    keywords: state.keywords,
    excludeAmbiguousN: state.excludeAmbiguousN
  };
}

export function restoreCollectionState(snapshot: PersistedJobSnapshot): CollectionFormState {
  return {
    taskName: snapshot.state.taskName || "Recovered_Gene_Collection",
    referenceSequence: "",
    taxid: snapshot.state.taxid || "",
    database: snapshot.state.database || BLAST_DEFAULTS.database,
    task: snapshot.state.task || BLAST_DEFAULTS.task,
    maxHits: snapshot.state.maxHits || BLAST_DEFAULTS.maxHits,
    expect: snapshot.state.expect || BLAST_DEFAULTS.expect,
    wordSize: snapshot.state.wordSize || BLAST_DEFAULTS.wordSize,
    tool: snapshot.state.tool || BLAST_DEFAULTS.tool,
    email: "",
    lengthFilterEnabled: snapshot.state.lengthFilterEnabled ?? FILTER_DEFAULTS.lengthFilterEnabled,
    minLengthPercent: snapshot.state.minLengthPercent ?? FILTER_DEFAULTS.minLengthPercent,
    maxLengthPercent: snapshot.state.maxLengthPercent ?? FILTER_DEFAULTS.maxLengthPercent,
    keywordFilterEnabled: snapshot.state.keywordFilterEnabled ?? FILTER_DEFAULTS.keywordFilterEnabled,
    keywords: snapshot.state.keywords || FILTER_DEFAULTS.keywords.join(", "),
    excludeAmbiguousN: snapshot.state.excludeAmbiguousN ?? FILTER_DEFAULTS.excludeAmbiguousN
  };
}

export function sanitizeLogs(logs: string[], rawSequence: string): string[] {
  const cleaned = cleanSequence(rawSequence);
  if (!cleaned || cleaned.length < 8) {
    return logs.slice(0, 20);
  }
  const pattern = new RegExp(escapeRegExp(cleaned), "gi");
  return logs.slice(0, 20).map((line) => line.replace(pattern, "[redacted_query_sequence]").replace(/RAW_BLAST_RESULT_TEXT/gi, "[redacted_raw_result]"));
}

export function isPersistedJobSnapshot(value: unknown): value is PersistedJobSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<PersistedJobSnapshot>;
  return (
    snapshot.schemaVersion === 2 &&
    typeof snapshot.id === "string" &&
    typeof snapshot.createdAt === "string" &&
    typeof snapshot.updatedAt === "string" &&
    typeof snapshot.state === "object" &&
    typeof snapshot.query === "object" &&
    typeof snapshot.query?.length === "number" &&
    typeof snapshot.query?.hash === "string" &&
    Array.isArray(snapshot.logs)
  );
}

function uniqueSnapshots(snapshots: PersistedJobSnapshot[]): PersistedJobSnapshot[] {
  const byId = new Map<string, PersistedJobSnapshot>();
  for (const snapshot of snapshots) {
    if (!snapshot?.id) continue;
    const existing = byId.get(snapshot.id);
    if (!existing || Date.parse(snapshot.updatedAt) > Date.parse(existing.updatedAt)) {
      byId.set(snapshot.id, snapshot);
    }
  }
  return [...byId.values()];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
