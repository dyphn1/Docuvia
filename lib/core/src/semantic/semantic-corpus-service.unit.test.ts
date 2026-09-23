import { describe, expect, it } from "vitest";
import {
  DocuviaError,
  ErrorCodes,
  type SemanticCorpusSample,
} from "@workspace/contracts";
import { SemanticCorpusService } from "./semantic-corpus-service.js";
import { corpusSample } from "./semantic-corpus-test-fixtures.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-corpus.md#p1-01--trusted-labels
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
const service = new SemanticCorpusService();

function expectInvalid(value: unknown) {
  expect(() => service.label(value)).toThrow(DocuviaError);
  expect(() => service.label(value)).toThrow(
    expect.objectContaining({ code: ErrorCodes.SEMANTIC_CORPUS_INVALID }),
  );
}

describe("semantic corpus trusted labels", () => {
  it("[happy] replays complete multi-target labels and candidate misses twice without mutation", () => {
    const sample = corpusSample();
    const before = structuredClone(sample);
    const expected = {
      sampleId: "sample-1",
      reason: "ready",
      labels: [
        {
          candidateId: " option a ",
          targetId: "src/a.ts#target",
          label: "confirmed-positive",
        },
        {
          candidateId: "b",
          targetId: "src/b.ts#target",
          label: "confirmed-negative",
        },
        { candidateId: "c", targetId: "src/c.ts#target", label: "unresolved" },
      ],
      goldTargetIds: ["src/a.ts#target", "src/missing.ts#target"],
      missingTargetIds: ["src/missing.ts#target"],
    };
    const first = service.label(sample);
    expect(first).toEqual(expected);
    (first.goldTargetIds as string[]).push("result-only");
    expect(service.label(sample)).toEqual(expected);
    expect(sample).toEqual(before);
  });

  it.each(["timeout", "empty", "not-ready", "unsupported", "error"] as const)(
    "[error-handling] preserves %s as oracle failure, never a negative",
    (status) => {
      const sample = corpusSample();
      const result = service.label({
        ...sample,
        oracle: { ...sample.oracle, status, targetIds: [] },
      });
      expect(result).toEqual({
        sampleId: sample.sampleId,
        reason: "oracle-failure",
        labels: sample.candidates.map((c) => ({
          candidateId: c.id,
          targetId: c.targetId,
          label: "unresolved",
        })),
        goldTargetIds: [],
        missingTargetIds: [],
      });
    },
  );

  it.each([
    [
      "stale oracle",
      (s: SemanticCorpusSample) => ({
        ...s,
        oracle: { ...s.oracle, snapshotHash: "c".repeat(64) },
      }),
      "freshness-mismatch",
    ],
    [
      "stale review",
      (s: SemanticCorpusSample) => ({
        ...s,
        review: { ...s.review, snapshotHash: "c".repeat(64) },
      }),
      "freshness-mismatch",
    ],
    [
      "conflict",
      (s: SemanticCorpusSample) => ({
        ...s,
        review: { ...s.review, status: "conflict" },
      }),
      "label-conflict",
    ],
    [
      "contradiction",
      (s: SemanticCorpusSample) => ({
        ...s,
        oracle: { ...s.oracle, targetIds: ["other"] },
      }),
      "label-conflict",
    ],
    [
      "overlapping gold",
      (s: SemanticCorpusSample) => ({
        ...s,
        review: {
          ...s.review,
          negativeTargetIds: [s.review.positiveTargetIds[0]],
        },
      }),
      "label-conflict",
    ],
    [
      "unreviewed",
      (s: SemanticCorpusSample) => ({
        ...s,
        review: { ...s.review, status: "unreviewed", evidenceRefs: [] },
      }),
      "unreviewed",
    ],
    [
      "empty response",
      (s: SemanticCorpusSample) => ({
        ...s,
        oracle: { ...s.oracle, targetIds: [] },
      }),
      "oracle-failure",
    ],
    [
      "truncated",
      (s: SemanticCorpusSample) => ({ ...s, truncated: true }),
      "input-truncated",
    ],
    [
      "scope",
      (s: SemanticCorpusSample) => ({
        ...s,
        source: { ...s.source, language: "python" },
      }),
      "out-of-scope",
    ],
    [
      "review scope",
      (s: SemanticCorpusSample) => ({
        ...s,
        review: { ...s.review, status: "out-of-scope" },
      }),
      "out-of-scope",
    ],
  ] as const)("[negative] quarantines %s", (_name, change, reason) => {
    const result = service.label(change(corpusSample()));
    expect(result.reason).toBe(reason);
    expect(result.labels.map((x) => x.label)).toEqual(
      Array(3).fill(reason === "out-of-scope" ? "out-of-scope" : "unresolved"),
    );
    expect(result.goldTargetIds).toEqual([]);
    expect(result.missingTargetIds).toEqual([]);
  });

  it("[boundary] records all missing targets with an empty candidate set", () => {
    const sample = corpusSample();
    expect(service.label({ ...sample, candidates: [] })).toEqual({
      sampleId: sample.sampleId,
      reason: "ready",
      labels: [],
      goldTargetIds: sample.review.positiveTargetIds,
      missingTargetIds: sample.review.positiveTargetIds,
    });
  });
  it("[boundary] accepts 32 frozen candidates and rejects 33", () => {
    const sample = corpusSample();
    const candidates = Array.from({ length: 32 }, (_, i) =>
      Object.freeze({ id: String(i), targetId: `target-${i}` }),
    );
    expect(
      service.label(
        Object.freeze({ ...sample, candidates: Object.freeze(candidates) }),
      ).labels,
    ).toHaveLength(32);
    expectInvalid({
      ...sample,
      candidates: [...candidates, { id: "33", targetId: "target-33" }],
    });
  });
  it.each([null, [], {}, "sample", 42])(
    "[invalid-input] rejects unexpected root %j",
    expectInvalid,
  );
  it.each([
    ["version", { schemaVersion: 2 }],
    ["unknown field", { verified: true }],
    ["blank ID", { sampleId: " " }],
    ["missing candidates", { candidates: undefined }],
    [
      "duplicate ID",
      {
        candidates: [
          { id: "a", targetId: "x" },
          { id: "a", targetId: "y" },
        ],
      },
    ],
    [
      "duplicate target",
      {
        candidates: [
          { id: "a", targetId: "x" },
          { id: "b", targetId: "x" },
        ],
      },
    ],
    ["sparse array", { candidates: Array(1) }],
    ["invalid truncation", { truncated: 1 }],
  ])("[invalid-input] rejects %s", (_name, patch) =>
    expectInvalid({ ...corpusSample(), ...patch }),
  );
  it("[invalid-input] rejects invalid nested metadata and missing independent evidence", () => {
    const sample = corpusSample();
    for (const [key, value] of Object.entries({
      snapshotHash: "abc",
      repoId: "",
      split: "unknown",
      usage: "public",
      origin: "unknown",
      license: "",
    })) {
      expectInvalid({ ...sample, source: { ...sample.source, [key]: value } });
    }
    expectInvalid({
      ...sample,
      oracle: { ...sample.oracle, status: "success" },
    });
    expectInvalid({
      ...sample,
      review: { ...sample.review, evidenceRefs: [] },
    });
    expectInvalid({
      ...sample,
      review: { ...sample.review, positiveTargetIds: ["a", "a"] },
    });
  });
  it("[invalid-input] rejects accessors without executing them", () => {
    let reads = 0;
    const sample = corpusSample();
    Object.defineProperty(sample.source, "repoId", {
      enumerable: true,
      get() {
        reads++;
        return "repo";
      },
    });
    expectInvalid(sample);
    expect(reads).toBe(0);
  });
});
