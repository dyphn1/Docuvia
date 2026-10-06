import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import DatabaseConstructor from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  CallSiteLspResolutionResult,
  CallSiteResolutionRecord,
} from "@workspace/contracts";
import { createPortableCallSiteKey } from "@workspace/contracts";
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

  it("[state-diff][error-handling] quarantines a contradicted signature and makes future rows ambiguous", () => {
    const callerId = store.graph.insertNode({
      projectId,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    const otherCallerId = store.graph.insertNode({
      projectId,
      name: "other caller",
      pathPatterns: ["src/other.ts"],
      nodeKey: "src/other.ts#caller",
    });
    const futureCallerId = store.graph.insertNode({
      projectId,
      name: "future caller",
      pathPatterns: ["src/future.ts"],
      nodeKey: "src/future.ts#caller",
    });
    const expectedTargetId = store.graph.insertNode({
      projectId,
      name: "expected",
      pathPatterns: ["src/expected.ts"],
      nodeKey: "src/expected.ts#run",
    });
    store.graph.insertNode({
      projectId,
      name: "observed",
      pathPatterns: ["src/observed.ts"],
      nodeKey: "src/observed.ts#run",
    });
    const unrelatedTargetId = store.graph.insertNode({
      projectId,
      name: "unrelated target",
      pathPatterns: ["src/unrelated-target.ts"],
      nodeKey: "src/unrelated-target.ts#run",
    });
    const unrelatedCallerId = store.graph.insertNode({
      projectId,
      name: "unrelated caller",
      pathPatterns: ["src/unrelated-caller.ts"],
      nodeKey: "src/unrelated-caller.ts#caller",
    });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: expectedTargetId,
      linkType: "imports",
    });

    const signature = "strict-proof-v1";
    const callerKey = siteKey("src/caller.ts");
    const otherKey = siteKey("src/other.ts");
    const futureKey = siteKey("src/future.ts");
    const callerResolution = {
      ...resolution(callerKey, [], {
        filePath: "src/caller.ts",
        callerNodeKey: "src/caller.ts#caller",
        ruleSignature: signature,
        selectedTargetNodeKey: "src/expected.ts#run",
      }),
    };
    const otherResolution = {
      ...resolution(otherKey, [], {
        filePath: "src/other.ts",
        callerNodeKey: "src/other.ts#caller",
        ruleSignature: signature,
        selectedTargetNodeKey: "src/expected.ts#run",
      }),
    };
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      callerResolution,
    ]);
    store.callSiteResolutions.replaceForFile(projectId, "src/other.ts", [
      otherResolution,
    ]);
    store.callSiteResolutions.replaceForFile(
      projectId,
      "src/unrelated-caller.ts",
      [
        resolution(siteKey("src/unrelated-caller.ts", "c".repeat(64)), [], {
          filePath: "src/unrelated-caller.ts",
          callerNodeKey: "src/unrelated-caller.ts#caller",
          sourceContentHash: "c".repeat(64),
          dependencies: [
            {
              filePath: "src/unrelated-caller.ts",
              contentHash: "c".repeat(64),
            },
          ],
          ruleSignature: "different-rule-v1",
          selectedTargetNodeKey: "src/unrelated-target.ts#run",
        }),
      ],
    );
    const otherProjectId = store.projects.insert({
      name: "call-resolution-other-project",
      repoUrl: `${tmpDir}-other`,
    }).id;
    const otherProjectCallerId = store.graph.insertNode({
      projectId: otherProjectId,
      name: "other project caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    const otherProjectTargetId = store.graph.insertNode({
      projectId: otherProjectId,
      name: "other project target",
      pathPatterns: ["src/expected.ts"],
      nodeKey: "src/expected.ts#run",
    });
    store.callSiteResolutions.replaceForFile(otherProjectId, "src/caller.ts", [
      resolution(siteKey("src/caller.ts"), [], {
        ruleSignature: signature,
        selectedTargetNodeKey: "src/expected.ts#run",
      }),
    ]);
    store.callSiteResolutions.appendObservation(projectId, {
      callSiteKey: callerKey,
      filePath: "src/caller.ts",
      sourceContentHash: "d".repeat(64),
      source: "strict-proof",
      resolutionClass: "proven",
      targetNodeKey: "src/expected.ts#run",
      ruleSignature: signature,
      evidenceJson: "{}",
    });

    const result: CallSiteLspResolutionResult = {
      callSiteKey: callerKey,
      sourceContentHash: "d".repeat(64),
      ruleSignature: signature,
      verificationPolicyVersion: "sha256-callsite-rule-class-v1",
      expectedTargetNodeKey: "src/expected.ts#run",
      resolutionClass: "proven",
      verificationMode: "tier-b",
      outcome: "unique-local",
      targetNodeKey: "src/observed.ts#run",
    };
    const applied = store.callSiteResolutions.applyTierBVerificationResults(
      projectId,
      [result],
    );
    store.callSiteResolutions.replaceForFile(projectId, "src/future.ts", [
      resolution(futureKey, [], {
        filePath: "src/future.ts",
        callerNodeKey: "src/future.ts#caller",
        ruleSignature: signature,
        selectedTargetNodeKey: "src/expected.ts#run",
      }),
    ]);

    expect({
      applied,
      futureResolution: store.callSiteResolutions.getForFile(
        projectId,
        "src/future.ts",
      )[0],
    }).toMatchObject({
      applied: {
        updatedCallSiteKeys: [callerKey, otherKey],
        affectedFilePaths: ["src/caller.ts", "src/other.ts"],
        quarantinedRuleSignatures: [signature],
      },
      futureResolution: {
        resolutionClass: "ambiguous",
        selectedTargetNodeKey: null,
        verificationStatus: "unverified",
        verifiedTargetNodeKey: null,
      },
    });
    expect(
      store.callSiteResolutions.getQuarantinedRuleSignatures(projectId),
    ).toEqual([signature]);
    expect(
      store.callSiteResolutions.getRuleQuarantines(projectId),
    ).toMatchObject([
      {
        ruleSignature: signature,
        policyVersion: "sha256-callsite-rule-class-v1",
        reason: "tier-b-target-mismatch",
        callSiteKey: callerKey,
        expectedTargetNodeKey: "src/expected.ts#run",
        observedTargetNodeKey: "src/observed.ts#run",
      },
    ]);
    expect(
      store.callSiteResolutions.getForFile(projectId, "src/caller.ts"),
    ).toMatchObject([
      {
        resolutionClass: "ambiguous",
        selectedTargetNodeKey: null,
        verificationStatus: "contradicted",
        verifiedTargetNodeKey: "src/observed.ts#run",
      },
    ]);
    expect(
      store.callSiteResolutions.getForFile(projectId, "src/other.ts"),
    ).toMatchObject([
      {
        resolutionClass: "ambiguous",
        selectedTargetNodeKey: null,
        verificationStatus: "unverified",
        verifiedTargetNodeKey: null,
      },
    ]);
    expect(
      store.callSiteResolutions.getObservations(projectId, "src/caller.ts"),
    ).toHaveLength(2);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([]);
    expect(
      store.graph
        .getOutgoingRelations(otherCallerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([]);
    expect(store.graph.getOutgoingRelations(callerId)).toContainEqual({
      id: expectedTargetId,
      name: "expected",
      type: "module",
      linkType: "imports",
    });
    expect(
      store.callSiteResolutions.getForFile(
        projectId,
        "src/unrelated-caller.ts",
      ),
    ).toMatchObject([
      {
        resolutionClass: "proven",
        selectedTargetNodeKey: "src/unrelated-target.ts#run",
      },
    ]);
    expect(
      store.graph
        .getOutgoingRelations(unrelatedCallerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      {
        id: unrelatedTargetId,
        name: "unrelated target",
        type: "module",
        linkType: "calls",
      },
    ]);
    expect(
      store.callSiteResolutions.getQuarantinedRuleSignatures(otherProjectId),
    ).toEqual([]);
    expect(
      store.callSiteResolutions.getForFile(otherProjectId, "src/caller.ts"),
    ).toMatchObject([
      {
        resolutionClass: "proven",
        selectedTargetNodeKey: "src/expected.ts#run",
      },
    ]);
    expect(
      store.graph
        .getOutgoingRelations(otherProjectCallerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      {
        id: otherProjectTargetId,
        name: "other project target",
        type: "module",
        linkType: "calls",
      },
    ]);

    expect(
      store.graph
        .getOutgoingRelations(futureCallerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([]);
  });

  it("[error-handling] rolls back signature quarantine, observations and projection together", () => {
    const callerId = store.graph.insertNode({
      projectId,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    const expectedTargetId = store.graph.insertNode({
      projectId,
      name: "expected",
      pathPatterns: ["src/expected.ts"],
      nodeKey: "src/expected.ts#run",
    });
    store.graph.insertNode({
      projectId,
      name: "observed",
      pathPatterns: ["src/observed.ts"],
      nodeKey: "src/observed.ts#run",
    });
    const callSiteKey = siteKey("src/caller.ts");
    const signature = "rollback-rule-v1";
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      resolution(callSiteKey, [], {
        ruleSignature: signature,
        selectedTargetNodeKey: "src/expected.ts#run",
      }),
    ]);
    const observationsBefore = store.callSiteResolutions.getObservations(
      projectId,
      "src/caller.ts",
    );
    const mismatch: CallSiteLspResolutionResult = {
      callSiteKey,
      sourceContentHash: "d".repeat(64),
      ruleSignature: signature,
      verificationPolicyVersion: "sha256-callsite-rule-class-v1",
      expectedTargetNodeKey: "src/expected.ts#run",
      resolutionClass: "proven",
      verificationMode: "canary",
      outcome: "unique-local",
      targetNodeKey: "src/observed.ts#run",
    };

    expect(() =>
      store.withTransaction(() => {
        store.callSiteResolutions.applyTierBVerificationResults(projectId, [
          mismatch,
        ]);
        throw new Error("force quarantine rollback");
      }),
    ).toThrow(/force quarantine rollback/);
    expect(
      store.callSiteResolutions.getQuarantinedRuleSignatures(projectId),
    ).toEqual([]);
    expect(
      store.callSiteResolutions.getForFile(projectId, "src/caller.ts"),
    ).toMatchObject([
      {
        resolutionClass: "proven",
        selectedTargetNodeKey: "src/expected.ts#run",
        verificationStatus: "unverified",
      },
    ]);
    expect(
      store.callSiteResolutions.getObservations(projectId, "src/caller.ts"),
    ).toEqual(observationsBefore);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      {
        id: expectedTargetId,
        name: "expected",
        type: "module",
        linkType: "calls",
      },
    ]);
  });

  it("[state-diff] treats non-unique responses as observations and verifies an equal target", () => {
    const callerId = store.graph.insertNode({
      projectId,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    const outcomes = [
      "no-result",
      "timeout",
      "external",
      "multi-location",
      "unique-local",
    ] as const;
    const records = outcomes.map((_, index) => {
      const targetNodeKey = `src/target-${index}.ts#run`;
      store.graph.insertNode({
        projectId,
        name: `target-${index}`,
        pathPatterns: [`src/target-${index}.ts`],
        nodeKey: targetNodeKey,
      });
      return resolution(
        siteKey("src/caller.ts", "d".repeat(64), 7 + index),
        [],
        {
          startColumn: 7 + index,
          ruleSignature: `non-contradiction-${index}`,
          selectedTargetNodeKey: targetNodeKey,
        },
      );
    });
    store.callSiteResolutions.replaceForFile(
      projectId,
      "src/caller.ts",
      records,
    );

    const results: CallSiteLspResolutionResult[] = outcomes.map(
      (outcome, index) => {
        const common = {
          callSiteKey: records[index].callSiteKey,
          sourceContentHash: records[index].sourceContentHash,
          ruleSignature: records[index].ruleSignature,
          verificationPolicyVersion: "sha256-callsite-rule-class-v1",
          expectedTargetNodeKey: records[index].selectedTargetNodeKey!,
          resolutionClass: "proven" as const,
          verificationMode: "canary" as const,
        };
        if (outcome === "unique-local") {
          return {
            ...common,
            outcome,
            targetNodeKey: records[index].selectedTargetNodeKey!,
          };
        }
        return { ...common, outcome };
      },
    );

    store.callSiteResolutions.applyTierBVerificationResults(projectId, results);

    expect(
      store.callSiteResolutions.getQuarantinedRuleSignatures(projectId),
    ).toEqual([]);
    const updatedRecords = new Map(
      store.callSiteResolutions
        .getForFile(projectId, "src/caller.ts")
        .map((record) => [record.callSiteKey, record]),
    );
    for (const [index, outcome] of outcomes.entries()) {
      expect(updatedRecords.get(records[index].callSiteKey)).toMatchObject({
        resolutionClass: "proven",
        verificationStatus:
          outcome === "unique-local" ? "verified" : "unverified",
      });
    }
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toHaveLength(5);
    expect(
      store.callSiteResolutions.getObservations(projectId, "src/caller.ts"),
    ).toHaveLength(5);
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

    expect(() =>
      store.withTransaction(() => {
        store.callSiteResolutions.deleteForFile(projectId, "src/caller.ts");
        throw new Error("force resolution deletion rollback");
      }),
    ).toThrow(/force resolution deletion rollback/);
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

  it("[state-diff] deletes current file state and call projection while retaining append-only observations", () => {
    const callerId = store.graph.insertNode({
      projectId,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    const otherCallerId = store.graph.insertNode({
      projectId,
      name: "other caller",
      pathPatterns: ["src/other-caller.ts"],
      nodeKey: "src/other-caller.ts#caller",
    });
    const targetId = store.graph.insertNode({
      projectId,
      name: "target",
      pathPatterns: ["src/target.ts"],
      nodeKey: "src/target.ts#run",
    });
    store.graph.insertLink({
      sourceNodeId: callerId,
      targetNodeId: targetId,
      linkType: "imports",
    });
    const callerKey = portableKey("a");
    const otherCallerKey = portableKey("b");
    const callerResolution = {
      ...resolution(callerKey, [
        {
          targetNodeKey: "src/target.ts#run",
          ordinal: 0,
          evidenceJson: "{}",
        },
      ]),
      selectedTargetNodeKey: "src/target.ts#run",
    };
    const otherResolution = {
      ...resolution(
        otherCallerKey,
        [
          {
            targetNodeKey: "src/target.ts#run",
            ordinal: 0,
            evidenceJson: "{}",
          },
        ],
        {
          filePath: "src/other-caller.ts",
          dependencies: [
            {
              filePath: "src/other-caller.ts",
              contentHash: "d".repeat(64),
            },
          ],
        },
      ),
      callerNodeKey: "src/other-caller.ts#caller",
      selectedTargetNodeKey: "src/target.ts#run",
    };
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      callerResolution,
    ]);
    store.callSiteResolutions.replaceForFile(projectId, "src/other-caller.ts", [
      otherResolution,
    ]);
    store.callSiteResolutions.appendObservation(projectId, {
      callSiteKey: callerKey,
      filePath: "src/caller.ts",
      sourceContentHash: "d".repeat(64),
      source: "strict-proof",
      resolutionClass: "proven",
      targetNodeKey: "src/target.ts#run",
      evidenceJson: "{}",
    });

    store.callSiteResolutions.deleteForFile(projectId, "src/caller.ts");

    expect(
      store.callSiteResolutions.getForFile(projectId, "src/caller.ts"),
    ).toEqual([]);
    expect(
      store.callSiteResolutions
        .getForFile(projectId, "src/other-caller.ts")
        .map(({ callSiteKey }) => callSiteKey),
    ).toEqual([otherCallerKey]);
    expect(
      store.callSiteResolutions.getObservations(projectId, "src/caller.ts"),
    ).toMatchObject([{ callSiteKey: callerKey }]);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([]);
    expect(store.graph.getOutgoingRelations(callerId)).toContainEqual({
      id: targetId,
      name: "target",
      type: "module",
      linkType: "imports",
    });
    expect(
      store.graph
        .getOutgoingRelations(otherCallerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      { id: targetId, name: "target", type: "module", linkType: "calls" },
    ]);

    const raw = new DatabaseConstructor(
      path.join(tmpDir, ".docuvia", "local.db"),
      { readonly: true },
    );
    try {
      for (const table of [
        "call_site_resolutions",
        "call_site_resolution_candidates",
        "call_site_resolution_dependencies",
      ]) {
        const row = raw
          .prepare(
            `SELECT COUNT(*) AS count FROM ${table}
             WHERE project_id = ? AND call_site_key = ?`,
          )
          .get(projectId, callerKey) as { count: number };
        expect(row.count).toBe(0);
      }
      const observations = raw
        .prepare(
          `SELECT COUNT(*) AS count FROM call_site_resolution_observations
           WHERE project_id = ? AND call_site_key = ?`,
        )
        .get(projectId, callerKey) as { count: number };
      expect(observations.count).toBe(1);
    } finally {
      raw.close();
    }
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
          { filePath: "src/target.ts", contentHash: "e".repeat(64) },
        ],
      },
      {
        ...resolution(freshKey, []),
        dependencies: [
          { filePath: "src/target.ts", contentHash: "f".repeat(64) },
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
        { filePath: "src/target.ts", contentHash: "f".repeat(64) },
      ]),
    ).toEqual({
      invalidatedCount: 1,
      affectedFilePaths: ["src/caller.ts"],
    });
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
        { filePath: "src/target.ts", contentHash: null },
      ]),
    ).toEqual({
      invalidatedCount: 1,
      affectedFilePaths: ["src/caller.ts"],
    });
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([]);
  });

  it("[error-handling][state-diff] rolls back invalidation when projection rebuilding fails", () => {
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
    const callSiteKey = portableKey("transactional-invalidation");
    const stableCallSiteKey = portableKey("transactional-stable-site");
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      resolution(callSiteKey, [], {
        dependencies: [
          { filePath: "src/target.ts", contentHash: "e".repeat(64) },
        ],
      }),
      resolution(stableCallSiteKey, [], {
        dependencies: [
          { filePath: "src/stable.ts", contentHash: "a".repeat(64) },
        ],
      }),
    ]);

    const raw = new DatabaseConstructor(
      path.join(tmpDir, ".docuvia", "local.db"),
    );
    try {
      raw.exec(
        `CREATE TRIGGER fail_call_projection_rebuild
         BEFORE INSERT ON node_links
         WHEN NEW.link_type = 'calls'
         BEGIN
           SELECT RAISE(ABORT, 'forced projection failure');
         END;`,
      );
    } finally {
      raw.close();
    }

    expect(() =>
      store.callSiteResolutions.invalidateChangedDependencies(projectId, [
        { filePath: "src/target.ts", contentHash: "f".repeat(64) },
      ]),
    ).toThrowError(
      `Failed to invalidate call-site resolutions for changed dependencies in project ${projectId}`,
    );

    const cleanup = new DatabaseConstructor(
      path.join(tmpDir, ".docuvia", "local.db"),
    );
    try {
      cleanup.exec("DROP TRIGGER fail_call_projection_rebuild;");
    } finally {
      cleanup.close();
    }

    expect(
      store.callSiteResolutions
        .getForFile(projectId, "src/caller.ts")
        .map(({ isStale }) => isStale),
    ).toEqual([false, false]);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      { id: targetId, name: "target", type: "module", linkType: "calls" },
    ]);
  });

  it("[state-diff] keeps an LSP-disproved target while another current site still selects it", () => {
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
    store.graph.insertNode({
      projectId,
      name: "alternate",
      pathPatterns: ["src/alternate.ts"],
      nodeKey: "src/alternate.ts#run",
    });
    const disprovedKey = portableKey("lsp-disproved-site");
    const currentKey = portableKey("current-sibling-site");
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      resolution(disprovedKey, [], { ruleSignature: "disproved-rule-v1" }),
      resolution(currentKey, [], { ruleSignature: "current-rule-v1" }),
    ]);

    expect(
      store.callSiteResolutions.applyTierBVerificationResults(projectId, [
        {
          callSiteKey: disprovedKey,
          sourceContentHash: "d".repeat(64),
          ruleSignature: "disproved-rule-v1",
          verificationPolicyVersion: "sha256-callsite-rule-class-v1",
          expectedTargetNodeKey: "src/target.ts#run",
          resolutionClass: "proven",
          verificationMode: "tier-b",
          outcome: "unique-local",
          targetNodeKey: "src/alternate.ts#run",
        },
      ]),
    ).toEqual({
      updatedCallSiteKeys: [disprovedKey],
      affectedFilePaths: ["src/caller.ts"],
      quarantinedRuleSignatures: ["disproved-rule-v1"],
    });
    expect(
      store.callSiteResolutions
        .getForFile(projectId, "src/caller.ts")
        .map(({ ruleSignature, resolutionClass, selectedTargetNodeKey }) => ({
          ruleSignature,
          resolutionClass,
          selectedTargetNodeKey,
        })),
    ).toEqual([
      {
        ruleSignature: "current-rule-v1",
        resolutionClass: "proven",
        selectedTargetNodeKey: "src/target.ts#run",
      },
      {
        ruleSignature: "disproved-rule-v1",
        resolutionClass: "ambiguous",
        selectedTargetNodeKey: null,
      },
    ]);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      { id: targetId, name: "target", type: "module", linkType: "calls" },
    ]);
  });

  it("[state-diff] ignores a Tier B result after dependency invalidation made its site stale", () => {
    const callerId = store.graph.insertNode({
      projectId,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    store.graph.insertNode({
      projectId,
      name: "target",
      pathPatterns: ["src/target.ts"],
      nodeKey: "src/target.ts#run",
    });
    const callSiteKey = portableKey("late-tier-b-site");
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      resolution(callSiteKey, [], {
        dependencies: [
          { filePath: "src/target.ts", contentHash: "e".repeat(64) },
        ],
      }),
    ]);
    store.callSiteResolutions.invalidateChangedDependencies(projectId, [
      { filePath: "src/target.ts", contentHash: "f".repeat(64) },
    ]);

    expect(
      store.callSiteResolutions.applyTierBVerificationResults(projectId, [
        {
          callSiteKey,
          sourceContentHash: "d".repeat(64),
          ruleSignature: "rule-v1",
          verificationPolicyVersion: "sha256-callsite-rule-class-v1",
          expectedTargetNodeKey: "src/target.ts#run",
          resolutionClass: "proven",
          verificationMode: "tier-b",
          outcome: "unique-local",
          targetNodeKey: "src/target.ts#run",
        },
      ]),
    ).toEqual({
      updatedCallSiteKeys: [],
      affectedFilePaths: [],
      quarantinedRuleSignatures: [],
    });
    expect(
      store.callSiteResolutions
        .getForFile(projectId, "src/caller.ts")
        .map(({ isStale, verificationStatus }) => ({
          isStale,
          verificationStatus,
        })),
    ).toEqual([{ isStale: true, verificationStatus: "unverified" }]);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([]);
  });

  it("[stress] invalidates a bounded batch of dependency-bound sites in one caller projection", () => {
    const callerId = store.graph.insertNode({
      projectId,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    store.graph.insertNode({
      projectId,
      name: "target",
      pathPatterns: ["src/target.ts"],
      nodeKey: "src/target.ts#run",
    });
    const callSiteKeys = Array.from({ length: 32 }, (_, index) =>
      portableKey(`stress-${index}`),
    );
    store.callSiteResolutions.replaceForFile(
      projectId,
      "src/caller.ts",
      callSiteKeys.map((callSiteKey) =>
        resolution(callSiteKey, [], {
          dependencies: [
            { filePath: "src/target.ts", contentHash: "e".repeat(64) },
          ],
        }),
      ),
    );

    expect(
      store.callSiteResolutions.invalidateChangedDependencies(projectId, [
        { filePath: "src/target.ts", contentHash: "f".repeat(64) },
      ]),
    ).toEqual({
      invalidatedCount: 32,
      affectedFilePaths: ["src/caller.ts"],
    });
    expect(
      store.callSiteResolutions
        .getForFile(projectId, "src/caller.ts")
        .map(({ isStale }) => isStale),
    ).toEqual(Array.from({ length: 32 }, () => true));
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([]);
  });

  it("[state-diff] leaves proof rows and projections unchanged for an unrelated dependency path", () => {
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
    const callSiteKey = portableKey("unrelated-path");
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      resolution(callSiteKey, [], {
        dependencies: [
          { filePath: "src/target.ts", contentHash: "e".repeat(64) },
        ],
      }),
    ]);

    expect(
      store.callSiteResolutions.invalidateChangedDependencies(projectId, [
        { filePath: "src/unrelated.ts", contentHash: "f".repeat(64) },
      ]),
    ).toEqual({ invalidatedCount: 0, affectedFilePaths: [] });
    expect(
      store.callSiteResolutions
        .getForFile(projectId, "src/caller.ts")
        .map(({ isStale }) => isStale),
    ).toEqual([false]);
    expect(
      store.graph
        .getOutgoingRelations(callerId)
        .filter(({ linkType }) => linkType === "calls"),
    ).toEqual([
      { id: targetId, name: "target", type: "module", linkType: "calls" },
    ]);
  });

  it("[state-diff] invalidates every current proof before a full source replacement", () => {
    const callerId = store.graph.insertNode({
      projectId,
      name: "caller",
      pathPatterns: ["src/caller.ts"],
      nodeKey: "src/caller.ts#caller",
    });
    store.graph.insertNode({
      projectId,
      name: "target",
      pathPatterns: ["src/target.ts"],
      nodeKey: "src/target.ts#run",
    });
    store.callSiteResolutions.replaceForFile(projectId, "src/caller.ts", [
      resolution(portableKey("full-invalidation-a"), []),
      resolution(portableKey("full-invalidation-b"), []),
    ]);

    expect(store.callSiteResolutions.invalidateAll(projectId)).toEqual({
      invalidatedCount: 2,
      affectedFilePaths: ["src/caller.ts"],
    });
    expect(
      store.callSiteResolutions
        .getForFile(projectId, "src/caller.ts")
        .map(({ isStale }) => isStale),
    ).toEqual([true, true]);
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
  overrides: Partial<CallSiteResolutionRecord> = {},
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

function portableKey(seed: string): string {
  return `call-site:v1:${createHash("sha256").update(seed).digest("hex")}`;
}

function siteKey(
  filePath: string,
  sourceContentHash = "d".repeat(64),
  startColumn = 7,
): string {
  return createPortableCallSiteKey({
    filePath,
    sourceContentHash,
    startLine: 2,
    startColumn,
    calleeKind: "bare",
    calleeName: "run",
  });
}
