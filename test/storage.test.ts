import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { BLAST_DEFAULTS, FILTER_DEFAULTS } from "../src/config/defaults";
import type { CollectionFormState } from "../src/domain/types";
import {
  buildJobSnapshot,
  deleteJobSnapshot,
  isPersistedJobSnapshot,
  listJobSnapshots,
  loadJobSnapshot,
  restoreCollectionState,
  sanitizeCollectionState,
  sanitizeLogs,
  saveJobSnapshot
} from "../src/services/storage";

describe("storage snapshot safety", () => {
  it("stores only safe recovery state, not raw query sequence or email", () => {
    const state = stateWithSensitiveValues();
    const snapshot = buildJobSnapshot(state, {
      status: "waiting",
      rid: "RID123",
      rtoeSeconds: 60,
      nextPollAt: 1_800_000_000_000,
      logs: ["Submit started for AAAACCCCGGGGTTTT", "raw result marker RAW_BLAST_RESULT_TEXT omitted"]
    });
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.state).toEqual(sanitizeCollectionState(state));
    expect(snapshot.query).toEqual({ length: 16, hash: expect.stringMatching(/^fnv1a32:[a-f0-9]{8}$/) });
    expect(serialized).not.toContain("AAAACCCCGGGGTTTT");
    expect(serialized).not.toContain(">fixture_header");
    expect(serialized).not.toContain("sample-email-value");
    expect(serialized).not.toContain("RAW_BLAST_RESULT_TEXT");
    expect(serialized).toContain("[redacted_query_sequence]");
  });

  it("restores form settings with blank reference sequence and email", () => {
    const snapshot = buildJobSnapshot(stateWithSensitiveValues(), {
      status: "waiting",
      rid: "RID123",
      logs: []
    });
    const restored = restoreCollectionState(snapshot);

    expect(restored.taskName).toBe("Sensitive Task");
    expect(restored.taxid).toBe("10244");
    expect(restored.referenceSequence).toBe("");
    expect(restored.email).toBe("");
    expect(restored.maxHits).toBe(20000);
    expect(restored.lengthFilterEnabled).toBe(true);
  });

  it("preserves prior query summary when a restored job has no raw sequence", () => {
    const snapshot = buildJobSnapshot(stateWithSensitiveValues(), { status: "waiting", rid: "RID123", logs: [] });
    const restored = restoreCollectionState(snapshot);
    const updated = buildJobSnapshot({ ...restored, maxHits: 50000 }, { status: "waiting", rid: "RID123", logs: [] }, snapshot);

    expect(updated.query).toEqual(snapshot.query);
    expect(JSON.stringify(updated)).not.toContain("AAAACCCCGGGGTTTT");
  });

  it("redacts raw sequence in logs case-insensitively", () => {
    expect(sanitizeLogs(["lower aaaaccccggggtttt leak"], "AAAACCCCGGGGTTTT")).toEqual(["lower [redacted_query_sequence] leak"]);
  });

  it("validates persisted snapshot shape", () => {
    const snapshot = buildJobSnapshot(stateWithSensitiveValues(), { status: "waiting", rid: "RID123", logs: [] });

    expect(isPersistedJobSnapshot(snapshot)).toBe(true);
    expect(isPersistedJobSnapshot({ ...snapshot, query: { length: "16", hash: snapshot.query.hash } })).toBe(false);
    expect(isPersistedJobSnapshot({ ...snapshot, schemaVersion: 1 })).toBe(false);
  });

  it("saves, loads, lists, and deletes IndexedDB snapshots", async () => {
    const snapshot = buildJobSnapshot(stateWithSensitiveValues(), {
      status: "waiting",
      rid: `RID${Date.now()}`,
      logs: []
    });

    await saveJobSnapshot(snapshot);
    expect(await loadJobSnapshot()).toMatchObject({ id: snapshot.id, rid: snapshot.rid });
    expect((await listJobSnapshots()).some((item) => item.id === snapshot.id)).toBe(true);

    await deleteJobSnapshot(snapshot.id);
    expect(await loadJobSnapshot()).toBeNull();
    expect((await listJobSnapshots()).some((item) => item.id === snapshot.id)).toBe(false);
  });
});

function stateWithSensitiveValues(): CollectionFormState {
  return {
    taskName: "Sensitive Task",
    referenceSequence: ">fixture_header\nAAAACCCCGGGGTTTT",
    taxid: "10244",
    database: BLAST_DEFAULTS.database,
    task: BLAST_DEFAULTS.task,
    maxHits: BLAST_DEFAULTS.maxHits,
    expect: BLAST_DEFAULTS.expect,
    wordSize: BLAST_DEFAULTS.wordSize,
    tool: BLAST_DEFAULTS.tool,
    email: "sample-email-value",
    lengthFilterEnabled: FILTER_DEFAULTS.lengthFilterEnabled,
    minLengthPercent: FILTER_DEFAULTS.minLengthPercent,
    maxLengthPercent: FILTER_DEFAULTS.maxLengthPercent,
    keywordFilterEnabled: FILTER_DEFAULTS.keywordFilterEnabled,
    keywords: FILTER_DEFAULTS.keywords.join(", "),
    excludeAmbiguousN: FILTER_DEFAULTS.excludeAmbiguousN
  };
}
