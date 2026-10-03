import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphStore } from "./graph-store.js";

describe("CallSiteResolutionsRepo (SQLite persistence)", () => {
  let tmpDir: string;
  let store: GraphStore;
  let projectId: number;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-call-resolution-"));
    store = await GraphStore.open({
      dbPath: path.join(tmpDir, ".docuvia", "local.db"),
    });
    projectId = store.projects.getOrInsert({
      name: "call-resolution-test",
      repoUrl: tmpDir,
    }).id;
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("[happy] persists normalized current resolution and ordered candidates", () => {
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      resolution(portableKey("a"), [
        {
          targetNodeKey: "src/b.ts#run",
          ordinal: 1,
          evidenceJson: '{"kind":"rank"}',
        },
        {
          targetNodeKey: "src/a.ts#run",
          ordinal: 0,
          evidenceJson: '{"kind":"import"}',
        },
      ]),
    ]);

    expect(
      store.callSiteResolutions.getForFile(projectId, "src/caller.ts"),
    ).toEqual([
      resolution(portableKey("a"), [
        {
          targetNodeKey: "src/a.ts#run",
          ordinal: 0,
          evidenceJson: '{"kind":"import"}',
        },
        {
          targetNodeKey: "src/b.ts#run",
          ordinal: 1,
          evidenceJson: '{"kind":"rank"}',
        },
      ]),
    ]);
  });

  it("[invalid-input] rejects a likely resolution without confidence", () => {
    expect(() =>
      store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
        resolution(portableKey("b"), [], {
          resolutionClass: "likely",
          confidence: null,
        }),
      ]),
    ).toThrow(/likely class requires confidence/);
  });

  it("[error-handling] rolls back a partial call-site replacement", () => {
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      resolution(portableKey("c"), []),
    ]);

    expect(() =>
      store.withTransaction(() => {
        store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
          resolution(portableKey("d"), []),
        ]);
        throw new Error("force outer rollback");
      }),
    ).toThrow(/force outer rollback/);
    expect(
      store.callSiteResolutions
        .getForFile(projectId, "src/caller.ts")
        .map(({ callSiteKey }) => callSiteKey),
    ).toEqual([portableKey("c")]);
  });

  it("[stress] retains every appended observation while replacing current state", () => {
    const observations = Array.from({ length: 20 }, (_, index) => ({
      callSiteKey: portableKey("e"),
      filePath: "src/caller.ts",
      sourceContentHash: "d".repeat(64),
      source: "scope-resolver" as const,
      targetNodeKey: `src/target-${index}.ts#run`,
      evidenceJson: JSON.stringify({ index }),
    }));
    for (const observation of observations) {
      store.callSiteResolutions.appendObservation(projectId, observation);
    }
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      resolution(portableKey("e"), []),
    ]);

    expect(
      store.callSiteResolutions.getObservations(projectId, "src/caller.ts"),
    ).toHaveLength(20);
  });

  it("[state-diff] removes stale candidates but retains append-only history on file reparse", () => {
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      resolution(portableKey("f"), [
        { targetNodeKey: "src/target.ts#run", ordinal: 0, evidenceJson: "{}" },
      ]),
    ]);
    store.callSiteResolutions.appendObservation(projectId, {
      callSiteKey: portableKey("f"),
      filePath: "src/caller.ts",
      sourceContentHash: "d".repeat(64),
      source: "strict-proof",
      targetNodeKey: "src/target.ts#run",
      evidenceJson: "{}",
    });

    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      resolution(portableKey("0"), []),
    ]);

    expect(
      store.callSiteResolutions
        .getForFile(projectId, "src/caller.ts")
        .map(({ callSiteKey, candidates }) => ({ callSiteKey, candidates })),
    ).toEqual([{ callSiteKey: portableKey("0"), candidates: [] }]);
    expect(
      store.callSiteResolutions.getObservations(projectId, "src/caller.ts"),
    ).toMatchObject([{ callSiteKey: portableKey("f") }]);
  });
});

function resolution(
  callSiteKey: string,
  candidates: Array<{
    targetNodeKey: string;
    ordinal: number;
    evidenceJson: string;
  }>,
  overrides: Partial<{
    resolutionClass:
      | "proven"
      | "likely"
      | "ambiguous"
      | "unresolved"
      | "external"
      | "unsupported";
    confidence: number | null;
  }> = {},
) {
  return {
    callSiteKey,
    identityVersion: 1 as const,
    filePath: "src/caller.ts",
    sourceContentHash: "d".repeat(64),
    startLine: 2,
    startColumn: 7,
    calleeKind: "bare" as const,
    calleeName: "run",
    callerNodeKey: "src/caller.ts#caller",
    resolutionClass: "proven" as const,
    selectedTargetNodeKey: "src/target.ts#run",
    confidence: null,
    resolver: "phase3-test",
    ruleSignature: "rule-v1",
    dependencyFingerprint: "e".repeat(64),
    verificationStatus: "unverified" as const,
    verifiedTargetNodeKey: null,
    isStale: false,
    candidates,
    ...overrides,
  };
}

function portableKey(digit: string): string {
  return `call-site:v1:${digit.repeat(64)}`;
}
