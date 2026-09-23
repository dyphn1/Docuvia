import { describe, expect, it } from "vitest";
import {
  DocuviaFactory,
  ErrorCodes,
  TOKENS,
  type SemanticCorpusManifest,
  type SemanticCorpusSample,
  type SemanticCorpusSplit,
} from "@workspace/contracts";
import { registerCoreProviders } from "../register.js";
import { SemanticCorpusService } from "./semantic-corpus-service.js";
import { corpusSample } from "./semantic-corpus-test-fixtures.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase1-corpus.md#p1-02--corpus-audit-and-repeatable-denominators
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
const service = new SemanticCorpusService();
function sample(
  id: string,
  split: SemanticCorpusSplit = "train",
  origin: "real" | "synthetic" = "real",
): SemanticCorpusSample {
  const value = corpusSample();
  return {
    ...value,
    sampleId: id,
    source: {
      ...value.source,
      repoId: `repo-${split}`,
      repoFamily: `family-${split}`,
      callSiteId: id,
      duplicateGroup: id,
      split,
      origin,
    },
  };
}
function manifest(
  samples: readonly SemanticCorpusSample[] = [],
): SemanticCorpusManifest {
  return {
    schemaVersion: 1,
    corpusId: "policy-fixture",
    corpusVersion: "1",
    splitSeed: "seed-1",
    samples,
  };
}
function fails(
  value: unknown,
  code: string = ErrorCodes.SEMANTIC_CORPUS_INVALID,
): void {
  expect(() => service.audit(value)).toThrow(expect.objectContaining({ code }));
}

describe("semantic corpus audit", () => {
  it("[happy] includes misses, truncation and all failures in a complete twice-replayed report", () => {
    const good = sample("a");
    const failed = {
      ...sample("b"),
      oracle: { ...good.oracle, status: "timeout", targetIds: [] },
    } as const;
    const stale = {
      ...sample("c"),
      oracle: { ...good.oracle, snapshotHash: "c".repeat(64) },
    };
    const truncated = { ...sample("d"), truncated: true, candidates: [] };
    const value = manifest([truncated, stale, failed, good]);
    const before = structuredClone(value);
    const first = service.audit(value);
    expect(first.real).toEqual({
      requests: 4,
      trustedGoldRequests: 2,
      goldTargets: 4,
      coveredTargets: 1,
      fullyCoveredRequests: 0,
      candidateRecall: 0.25,
      setCoverage: 0,
    });
    expect(first.reasons).toEqual({
      ready: 1,
      "oracle-failure": 1,
      "freshness-mismatch": 1,
      "input-truncated": 1,
      "label-conflict": 0,
      "out-of-scope": 0,
      unreviewed: 0,
    });
    expect(first.results.map((r) => [r.sampleId, r.reason])).toEqual([
      ["a", "ready"],
      ["b", "oracle-failure"],
      ["c", "freshness-mismatch"],
      ["d", "input-truncated"],
    ]);
    expect(first.gates).toEqual({
      sampleSize: "insufficient-evidence",
      candidateRecall: "insufficient-evidence",
    });
    expect(first.independentReadyRealRequests).toEqual({
      train: 1,
      calibration: 0,
      test: 0,
      temporal: 0,
    });
    expect(first.slices).toHaveLength(8);
    expect(first.slices[0]).toEqual({
      origin: "real",
      split: "train",
      metrics: first.real,
    });
    expect(first.datasetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(service.audit(manifest([...value.samples].reverse()))).toEqual(
      first,
    );
    expect(value).toEqual(before);
  });
  it("[boundary] reports zero denominators as null and synthetic-only data as insufficient", () => {
    const empty = service.audit(manifest());
    expect(empty.real).toEqual({
      requests: 0,
      trustedGoldRequests: 0,
      goldTargets: 0,
      coveredTargets: 0,
      fullyCoveredRequests: 0,
      candidateRecall: null,
      setCoverage: null,
    });
    expect(empty.gates).toEqual({
      sampleSize: "insufficient-evidence",
      candidateRecall: "insufficient-evidence",
    });
    const synthetic = service.audit(
      manifest([sample("synthetic", "test", "synthetic")]),
    );
    expect(synthetic.synthetic.candidateRecall).toBe(0.5);
    expect(synthetic.real.requests).toBe(0);
    expect(synthetic.readyRealFamilies.test).toBe(0);
    expect(synthetic.gates).toEqual(empty.gates);
  });
  it("[happy] hashes content and metadata canonically, preserving candidate order", () => {
    const value = manifest([sample("a")]);
    const first = service.audit(value);
    const reordered = Object.fromEntries(Object.entries(value).reverse());
    expect(service.audit(reordered)).toEqual(first);
    expect(
      service.audit({ ...value, splitSeed: "seed-2" }).datasetHash,
    ).not.toBe(first.datasetHash);
    expect(
      service.audit(
        manifest([
          {
            ...value.samples[0],
            candidates: [...value.samples[0].candidates].reverse(),
          },
        ]),
      ).datasetHash,
    ).not.toBe(first.datasetHash);
  });
  it("[negative] does not inflate independent request counts with neighboring revisions", () => {
    const a = sample("a");
    const b = {
      ...sample("b"),
      source: { ...a.source, revision: "rev-2", snapshotHash: "c".repeat(64) },
      oracle: { ...a.oracle, snapshotHash: "c".repeat(64) },
      review: { ...a.review, snapshotHash: "c".repeat(64) },
    };
    const report = service.audit(manifest([a, b]));
    expect(report.real.requests).toBe(2);
    expect(report.independentReadyRealRequests.train).toBe(1);
  });
  it.each(["calibration", "test", "temporal"] as const)(
    "[negative] rejects family leakage into %s",
    (split) => {
      const a = sample("a");
      const b = sample("b", split);
      fails(
        manifest([
          a,
          { ...b, source: { ...b.source, repoFamily: a.source.repoFamily } },
        ]),
        ErrorCodes.SEMANTIC_CORPUS_LEAKAGE,
      );
    },
  );
  it("[happy] permits temporal holdout in a sealed-test family without sharing fragments", () => {
    const sealed = sample("sealed", "test");
    const temporal = sample("later", "temporal");
    const report = service.audit(
      manifest([
        sealed,
        {
          ...temporal,
          source: {
            ...temporal.source,
            repoId: sealed.source.repoId,
            repoFamily: sealed.source.repoFamily,
            revision: "later-revision",
          },
        },
      ]),
    );
    expect(report.independentReadyRealRequests).toEqual({
      train: 0,
      calibration: 0,
      test: 1,
      temporal: 1,
    });
  });

  it("[negative] rejects fragment leakage across unrelated declared families", () => {
    const a = sample("a");
    const b = sample("b", "test");
    fails(
      manifest([
        a,
        {
          ...b,
          source: { ...b.source, duplicateGroup: a.source.duplicateGroup },
        },
      ]),
      ErrorCodes.SEMANTIC_CORPUS_LEAKAGE,
    );
  });
  it("[negative] enforces evaluation-only permission before training", () => {
    const a = sample("a");
    fails(
      manifest([{ ...a, source: { ...a.source, usage: "evaluation-only" } }]),
      ErrorCodes.SEMANTIC_CORPUS_LEAKAGE,
    );
    expect(
      service.audit(
        manifest([
          {
            ...a,
            source: { ...a.source, split: "test", usage: "evaluation-only" },
          },
        ]),
      ).real.requests,
    ).toBe(1);
  });
  it("[invalid-input] rejects duplicated IDs, repeated snapshots and repo-family laundering", () => {
    const a = sample("a");
    const b = sample("b");
    fails(manifest([a, { ...b, sampleId: a.sampleId }]));
    fails(manifest([a, { ...b, source: a.source }]));
    fails(
      manifest([a, { ...b, source: { ...b.source, repoFamily: "different" } }]),
    );
  });
  it.each([
    null,
    [],
    {},
    { ...manifest(), extra: true },
    { ...manifest(), splitSeed: "" },
    { ...manifest(), samples: Array(1) },
    { ...manifest(), samples: Array(100001) },
  ])("[invalid-input] rejects malformed/oversized manifest %j", (value) =>
    fails(value),
  );
  it("[error-handling] propagates invalid sample data instead of emitting a passing report", () => {
    fails({ ...manifest(), samples: [{ ...sample("a"), oracle: null }] });
    const value = manifest();
    Object.defineProperty(value, "samples", {
      get() {
        throw new Error("must not execute");
      },
      enumerable: true,
    });
    fails(value);
  });
  it("[happy] exposes the audit through a transient contracts factory for two complete replays", () => {
    const factory = new DocuviaFactory();
    registerCoreProviders(factory);
    factory.lock();
    const a = factory.resolve(TOKENS.SemanticCorpusService);
    const b = factory.resolve(TOKENS.SemanticCorpusService);
    expect(a).not.toBe(b);
    const value = manifest([sample("a")]);
    const expected = a.audit(value);
    expect(b.audit(value)).toEqual(expected);
    expect(expected.results[0].missingTargetIds).toEqual([
      "src/missing.ts#target",
    ]);
  });
  it("[boundary] freezes the 4/2/2, 10000/2000 and temporal sample-size gates", () => {
    // Generated policy records only: origin=real exercises declared-source accounting,
    // not an assertion that these fixture records constitute a collected real corpus.
    const samples: SemanticCorpusSample[] = [];
    for (const [split, count, families] of [
      ["train", 6000, 4],
      ["calibration", 2000, 2],
      ["test", 2000, 2],
      ["temporal", 1, 1],
    ] as const) {
      for (let i = 0; i < count; i++) {
        const s = sample(`${split}-${i}`, split);
        samples.push({
          ...s,
          source: {
            ...s.source,
            repoId: `${split}-${i % families}`,
            repoFamily: `${split}-${i % families}`,
          },
          candidates: [
            { id: "a", targetId: "src/a.ts#target" },
            { id: "missing", targetId: "src/missing.ts#target" },
          ],
        });
      }
    }
    const report = service.audit(manifest(samples));
    expect(report.gates).toEqual({
      sampleSize: "pass",
      candidateRecall: "pass",
    });
    expect(report.readyRealFamilies).toEqual({
      train: 4,
      calibration: 2,
      test: 2,
      temporal: 1,
    });

    const maskedTestMisses = samples.map((s) => {
      if (
        s.source.split !== "test" ||
        Number(s.sampleId.slice("test-".length)) >= 100
      )
        return s;
      return {
        ...s,
        candidates: [{ id: "a", targetId: "src/a.ts#target" }],
      };
    });
    const maskedReport = service.audit(manifest(maskedTestMisses));
    expect(maskedReport.real.candidateRecall).toBeGreaterThanOrEqual(0.99);
    expect(
      maskedReport.slices.find(
        (slice) => slice.origin === "real" && slice.split === "test",
      )?.metrics.candidateRecall,
    ).toBeLessThan(0.99);
    expect(maskedReport.gates.candidateRecall).toBe("fail");

    expect(
      service.audit(manifest(samples.filter((s) => s.sampleId !== "test-1999")))
        .gates.sampleSize,
    ).toBe("insufficient-evidence");
    expect(service.audit(manifest(samples.slice(0, -1))).gates.sampleSize).toBe(
      "insufficient-evidence",
    );
  });
});
