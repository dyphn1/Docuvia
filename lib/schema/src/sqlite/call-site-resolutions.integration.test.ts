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
    const callerId = store.graph.insertNode({
      projectId,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    const originalTargetId = store.graph.insertNode({
      projectId,
      name: "original",
      pathPatterns: ["src/original.ts"],
      nodeKey: "src/original.ts#run",
    });
    store.graph.insertNode({
      projectId,
      name: "replacement",
      pathPatterns: ["src/replacement.ts"],
      nodeKey: "src/replacement.ts#run",
    });
    const original = {
      ...resolution(portableKey("c"), []),
      callerNodeKey: "src/caller.ts#caller",
      selectedTargetNodeKey: "src/original.ts#run",
    };
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      original,
    ]);

    expect(() =>
      store.withTransaction(() => {
        store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
          {
            ...original,
            callSiteKey: portableKey("d"),
            selectedTargetNodeKey: "src/replacement.ts#run",
          },
        ]);
        throw new Error("force outer rollback");
      }),
    ).toThrow(/force outer rollback/);
    expect(
      store.callSiteResolutions
        .getForFile(projectId, "src/caller.ts")
        .map(({ callSiteKey }) => callSiteKey),
    ).toEqual([portableKey("c")]);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      {
        id: originalTargetId,
        name: "original",
        type: "module",
        linkType: "calls",
      },
    ]);
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

  it("[state-diff] projects current selected calls per caller file and removes them on replacement or deletion", () => {
    const callerId = store.graph.insertNode({
      projectId,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    const firstTargetId = store.graph.insertNode({
      projectId,
      name: "first",
      pathPatterns: ["src/first.ts"],
      nodeKey: "src/first.ts#run",
    });
    const secondTargetId = store.graph.insertNode({
      projectId,
      name: "second",
      pathPatterns: ["src/second.ts"],
      nodeKey: "src/second.ts#run",
    });
    const otherCallerId = store.graph.insertNode({
      projectId,
      name: "other caller",
      pathPatterns: ["src/other-caller.ts"],
      nodeKey: "src/other-caller.ts#caller",
    });
    const otherTargetId = store.graph.insertNode({
      projectId,
      name: "other target",
      pathPatterns: ["src/other-target.ts"],
      nodeKey: "src/other-target.ts#run",
    });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: firstTargetId,
      linkType: "imports",
    });
    store.callSiteResolutions.replaceForFile(projectId, "src/other-caller.ts", [
      {
        ...resolution(portableKey("9"), [], {
          filePath: "src/other-caller.ts",
          dependencies: [
            {
              filePath: "src/other-caller.ts",
              contentHash: "d".repeat(64),
            },
          ],
        }),
        callerNodeKey: "src/other-caller.ts#caller",
        selectedTargetNodeKey: "src/other-target.ts#run",
      },
    ]);

    const first = {
      ...resolution(portableKey("7"), []),
      callerNodeKey: "src/caller.ts#caller",
      selectedTargetNodeKey: "src/first.ts#run",
    };
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      first,
      { ...first, callSiteKey: portableKey("8") },
    ]);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      { id: firstTargetId, name: "first", type: "module", linkType: "calls" },
    ]);

    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      first,
      {
        ...first,
        callSiteKey: portableKey("8"),
        selectedTargetNodeKey: "src/first.ts#run",
      },
    ]);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toHaveLength(1);

    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      {
        ...first,
        callSiteKey: portableKey("8"),
        selectedTargetNodeKey: "src/second.ts#run",
      },
    ]);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      { id: secondTargetId, name: "second", type: "module", linkType: "calls" },
    ]);

    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", []);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([]);
    expect(store.graph.getOutgoingRelations(callerId)).toContainEqual({
      id: firstTargetId,
      name: "first",
      type: "module",
      linkType: "imports",
    });
    expect(
      store.graph
        .getOutgoingRelations(otherCallerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      {
        id: otherTargetId,
        name: "other target",
        type: "module",
        linkType: "calls",
      },
    ]);
  });

  it("[state-diff] marks only sites that consulted a changed dependency stale", () => {
    const callerId = store.graph.insertNode({
      projectId,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    const targetId = store.graph.insertNode({
      projectId,
      name: "target",
      pathPatterns: ["src/target.ts"],
      nodeKey: "src/target.ts#run",
    });
    const staleKey = portableKey("1");
    const freshKey = portableKey("2");
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      {
        ...resolution(staleKey, []),
        dependencies: [
          { filePath: "src/dependency.ts", contentHash: "e".repeat(64) },
        ],
      },
      {
        ...resolution(freshKey, []),
        dependencies: [
          { filePath: "src/dependency.ts", contentHash: "f".repeat(64) },
        ],
      },
    ]);
    store.callSiteResolutions.replaceForFile(projectId, "src/other-caller.ts", [
      resolution(portableKey("3"), [], {
        filePath: "src/other-caller.ts",
        dependencies: [
          { filePath: "src/unrelated.ts", contentHash: "a".repeat(64) },
        ],
      }),
    ]);

    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      { id: targetId, name: "target", type: "module", linkType: "calls" },
    ]);

    expect(
      store.callSiteResolutions.invalidateChangedDependencies(projectId, [
        { filePath: "src/dependency.ts", contentHash: "f".repeat(64) },
      ]),
    ).toBe(1);
    expect(
      store.callSiteResolutions
        .getForFile(projectId, "src/caller.ts")
        .map(({ callSiteKey, isStale }) => ({ callSiteKey, isStale })),
    ).toEqual([
      { callSiteKey: staleKey, isStale: true },
      { callSiteKey: freshKey, isStale: false },
    ]);
    expect(
      store.callSiteResolutions.getForFile(projectId, "src/other-caller.ts"),
    ).toMatchObject([{ callSiteKey: portableKey("3"), isStale: false }]);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      { id: targetId, name: "target", type: "module", linkType: "calls" },
    ]);

    expect(
      store.callSiteResolutions.invalidateChangedDependencies(projectId, [
        { filePath: "src/dependency.ts", contentHash: "a".repeat(64) },
      ]),
    ).toBe(1);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([]);
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
    filePath: string;
    resolutionClass:
      | "proven"
      | "likely"
      | "ambiguous"
      | "unresolved"
      | "external"
      | "unsupported";
    confidence: number | null;
    dependencies: Array<{ filePath: string; contentHash: string | null }>;
  }> = {},
) {
  return {
    callSiteKey,
    identityVersion: 1 as const,
    filePath: overrides.filePath ?? "src/caller.ts",
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
    dependencies: overrides.dependencies ?? [
      { filePath: "src/caller.ts", contentHash: "d".repeat(64) },
    ],
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
