import type { SemanticCorpusSample } from "@workspace/contracts";

/** Synthetic policy fixture, never counted as evidence from a real repository. */
export function corpusSample(): SemanticCorpusSample {
  return {
    schemaVersion: 1,
    sampleId: "sample-1",
    source: {
      repoId: "fixture",
      repoFamily: "fixture-family",
      revision: "rev-1",
      projectId: "project",
      callSiteId: "src/caller.ts:1:1",
      snapshotHash: "a".repeat(64),
      duplicateGroup: "fragment-1",
      license: "MIT",
      usage: "training-and-evaluation",
      origin: "synthetic",
      split: "train",
      language: "typescript",
      relation: "cross-file-call",
    },
    candidates: [
      { id: " option a ", targetId: "src/a.ts#target" },
      { id: "b", targetId: "src/b.ts#target" },
      { id: "c", targetId: "src/c.ts#target" },
    ],
    truncated: false,
    oracle: {
      status: "resolved",
      server: "typescript-language-server",
      version: "fixture-1",
      configHash: "b".repeat(64),
      snapshotHash: "a".repeat(64),
      targetIds: ["src/a.ts#target", "src/missing.ts#target"],
    },
    review: {
      status: "confirmed",
      snapshotHash: "a".repeat(64),
      positiveTargetIds: ["src/a.ts#target", "src/missing.ts#target"],
      negativeTargetIds: ["src/b.ts#target"],
      evidenceRefs: ["compiler-fixture:multi-target"],
    },
  };
}
