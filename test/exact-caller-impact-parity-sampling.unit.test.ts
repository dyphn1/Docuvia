import { describe, expect, it } from "vitest";
import {
  EXACT_CALLER_ADDITION_CATEGORIES,
  distribution,
  estimatePopulationWeightedPrecision,
  evaluateAcceptanceGate,
  extractCallSiteEvidence,
  findMatchingReviewLabel,
  buildEvidenceFingerprint,
  buildExactCallerSampleKey,
  buildRepositoryIdentity,
  indexAuditsByIdentity,
  assertUniqueRepositoryIdentities,
  hasPathSegment,
  isExcludedBundlePath,
  labelCounts,
  limitSourceEvidence,
  partitionBundleReviewCandidates,
  selectSeededStratifiedSample,
} from "../scripts/semantic-corpus/exact-caller-impact-parity-sampling.js";
import { computeRiskLevelFromCounts } from "../lib/core/src/impact/impact.service.js";
import { filterConfirmedImpactDependencies } from "../lib/ui-core/src/workflows/impact/is-confirmed-impact-dependency.js";

const EMPTY_ELIGIBLE_COUNTS = Object.fromEntries(
  EXACT_CALLER_ADDITION_CATEGORIES.map((category) => [category, 0]),
) as Record<(typeof EXACT_CALLER_ADDITION_CATEGORIES)[number], number>;

describe("exact caller parity sampling", () => {
  it("[happy] selects a deterministic, balanced sample independent of input order", () => {
    const candidates = EXACT_CALLER_ADDITION_CATEGORIES.flatMap((category) =>
      Array.from({ length: 4 }, (_, index) => ({
        category,
        sampleKey: `${category}-${index}`,
      })),
    );

    const sample = selectSeededStratifiedSample(candidates, 10, "seed-1");
    const reversedSample = selectSeededStratifiedSample(
      [...candidates].reverse(),
      10,
      "seed-1",
    );

    expect(sample).toEqual(reversedSample);
    expect(sample).toHaveLength(10);
    expect(
      Object.fromEntries(
        EXACT_CALLER_ADDITION_CATEGORIES.map((category) => [
          category,
          sample.filter((item) => item.category === category).length,
        ]),
      ),
    ).toEqual({
      "anonymous-callback/lexical-parent": 2,
      "ambiguous-spans": 2,
      "class-ownership": 2,
      "caller-candidate": 2,
      other: 2,
    });
  });

  it("redistributes empty strata and reports nearest-rank p90 deltas", () => {
    const candidates = [
      { category: "other", sampleKey: "a" },
      { category: "other", sampleKey: "b" },
      { category: "caller-candidate", sampleKey: "c" },
    ];

    expect(selectSeededStratifiedSample(candidates, 3, "seed-2")).toHaveLength(
      3,
    );
    expect(distribution([1, 2, 3, 4, 5])).toEqual({
      count: 5,
      median: 3,
      p90: 5,
      min: 1,
      max: 5,
    });
  });

  it("reports judged and conservative precision with unsure items kept in the denominator", () => {
    const counts = labelCounts([
      { category: "caller-candidate", label: "TP" },
      { category: "caller-candidate", label: "FP" },
      { category: "caller-candidate", label: "unsure" },
    ]);

    expect(counts["caller-candidate"]).toMatchObject({
      sampleCount: 3,
      truePositives: 1,
      falsePositives: 1,
      unsure: 1,
      judgedPrecision: 0.5,
      conservativePrecision: 1 / 3,
    });
  });

  it("[invalid-input] returns inconclusive when a large stratum has fewer than ten labels", () => {
    const eligibleCounts = { ...EMPTY_ELIGIBLE_COUNTS, other: 20 };
    const sample = [
      { category: "other" as const, sampleKey: "one", label: "TP" as const },
    ];
    const weighted = estimatePopulationWeightedPrecision(
      eligibleCounts,
      sample,
    );

    const gate = evaluateAcceptanceGate(eligibleCounts, sample, weighted);

    expect(gate.status).toBe("inconclusive");
    expect(gate.insufficientCoverageCategories).toEqual(["other"]);
  });

  it("[invalid-input] returns inconclusive when a small stratum is not exhaustively labeled", () => {
    const eligibleCounts = { ...EMPTY_ELIGIBLE_COUNTS, other: 5 };
    const sample = [
      { category: "other" as const, sampleKey: "one", label: "TP" as const },
      { category: "other" as const, sampleKey: "two", label: "FP" as const },
      {
        category: "other" as const,
        sampleKey: "three",
        label: "unsure" as const,
      },
    ];
    const weighted = estimatePopulationWeightedPrecision(
      eligibleCounts,
      sample,
    );

    const gate = evaluateAcceptanceGate(eligibleCounts, sample, weighted);

    expect(gate.status).toBe("inconclusive");
    expect(gate.insufficientCoverageCategories).toEqual(["other"]);
  });

  it("[invalid-input] does not count placeholder labels as reviewed coverage", () => {
    const eligibleCounts = { ...EMPTY_ELIGIBLE_COUNTS, other: 20 };
    const sample = Array.from({ length: 10 }, (_, index) => ({
      category: "other" as const,
      sampleKey: `other-${index}`,
      label: "unsure" as const,
      reviewed: false,
    }));
    const weighted = estimatePopulationWeightedPrecision(
      eligibleCounts,
      sample,
    );

    const gate = evaluateAcceptanceGate(eligibleCounts, sample, weighted);

    expect(gate.status).toBe("inconclusive");
    expect(gate.insufficientCoverageCategories).toEqual(["other"]);
  });

  it("[invalid-input] invalidates a label when source evidence changes under stable node keys", () => {
    const repositoryIdentity = buildRepositoryIdentity(
      "https://example.test/team/repo.git",
      "/workspace/repo",
      "head-1",
    );
    const sampleKey = buildExactCallerSampleKey(
      repositoryIdentity,
      "target-node",
      "caller-node",
    );
    const originalFingerprint = buildEvidenceFingerprint(
      "head-1",
      "exact-enclosing-v2",
      {
        targetSnippet: "function target() {}",
        addedCallerSnippet: "function caller() { target(); }",
        callSiteSnippets: ["target();"],
      },
    );
    const changedFingerprint = buildEvidenceFingerprint(
      "head-1",
      "exact-enclosing-v2",
      {
        targetSnippet: "function target() {}",
        addedCallerSnippet: "function caller() { unrelated(); }",
        callSiteSnippets: ["unrelated();"],
      },
    );
    const previousLabel = findMatchingReviewLabel(
      [
        {
          sampleKey,
          evidenceFingerprint: originalFingerprint,
          label: "TP",
          justification: "Reviewed source.",
        },
      ],
      sampleKey,
      changedFingerprint,
    );
    const eligibleCounts = { ...EMPTY_ELIGIBLE_COUNTS, other: 20 };
    const sample = [
      {
        category: "other" as const,
        sampleKey,
        label: previousLabel?.label ?? ("unsure" as const),
        reviewed: previousLabel !== undefined,
      },
    ];
    const weighted = estimatePopulationWeightedPrecision(
      eligibleCounts,
      sample,
    );

    expect(previousLabel).toEqual(undefined);
    expect(
      evaluateAcceptanceGate(eligibleCounts, sample, weighted).status,
    ).toBe("inconclusive");
  });

  it("[invalid-input] isolates same-basename repositories and rejects duplicate audit identities", () => {
    const firstIdentity = buildRepositoryIdentity(
      null,
      "/audit/one/shared",
      "head-one",
    );
    const secondIdentity = buildRepositoryIdentity(
      null,
      "/audit/two/shared",
      "head-two",
    );
    const firstSampleKey = buildExactCallerSampleKey(
      firstIdentity,
      "target",
      "caller",
    );
    const secondSampleKey = buildExactCallerSampleKey(
      secondIdentity,
      "target",
      "caller",
    );

    expect(firstIdentity).not.toBe(secondIdentity);
    expect(firstSampleKey).not.toBe(secondSampleKey);
    expect(
      findMatchingReviewLabel(
        [
          {
            sampleKey: firstSampleKey,
            evidenceFingerprint: "same-source-hash",
            label: "TP",
            justification: "Only applies to the first root.",
          },
        ],
        secondSampleKey,
        "same-source-hash",
      ),
    ).toEqual(undefined);
    const indexed = indexAuditsByIdentity([
      {
        repository: "shared",
        repositoryIdentity: firstIdentity,
        sourceBody: "first repo source",
      },
      {
        repository: "shared",
        repositoryIdentity: secondIdentity,
        sourceBody: "second repo source",
      },
    ]);
    expect(indexed.get(firstIdentity)?.sourceBody).toBe("first repo source");
    expect(indexed.get(secondIdentity)?.sourceBody).toBe("second repo source");
    expect(() =>
      indexAuditsByIdentity([
        { repository: "shared", repositoryIdentity: firstIdentity },
        { repository: "shared", repositoryIdentity: firstIdentity },
      ]),
    ).toThrow("Duplicate repository audit identity");
  });

  it("[happy] weights precision by eligible stratum counts and returns simultaneous Wilson bounds", () => {
    const eligibleCounts = {
      ...EMPTY_ELIGIBLE_COUNTS,
      "anonymous-callback/lexical-parent": 100,
      other: 10,
    };
    const sample = [
      ...Array.from({ length: 10 }, (_, index) => ({
        category: "anonymous-callback/lexical-parent" as const,
        sampleKey: `callback-${index}`,
        label: index === 9 ? ("FP" as const) : ("TP" as const),
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        category: "other" as const,
        sampleKey: `other-${index}`,
        label: "FP" as const,
      })),
    ];

    const estimate = estimatePopulationWeightedPrecision(
      eligibleCounts,
      sample,
    );

    expect(estimate.estimate).toBeCloseTo(90 / 110, 6);
    expect(estimate.strata["anonymous-callback/lexical-parent"]).toMatchObject({
      eligibleCount: 100,
      sampleCount: 10,
      truePositives: 9,
      falsePositives: 1,
      unsure: 0,
    });
    expect(estimate.interval.confidenceLevel).toBe(0.95);
    expect(estimate.interval.lower).toBeLessThan(estimate.estimate ?? 0);
    expect(estimate.interval.upper).toBeGreaterThan(estimate.estimate ?? 0);
  });

  it("[happy] allows a fully covered, exact census to pass the precision gate", () => {
    const eligibleCounts = { ...EMPTY_ELIGIBLE_COUNTS, other: 100 };
    const sample = Array.from({ length: 100 }, (_, index) => ({
      category: "other" as const,
      sampleKey: `other-${index}`,
      label: "TP" as const,
    }));
    const weighted = estimatePopulationWeightedPrecision(
      eligibleCounts,
      sample,
    );

    expect(
      evaluateAcceptanceGate(eligibleCounts, sample, weighted).status,
    ).toBe("pass");
  });

  it("[happy] uses confirmed caller entries as the product risk numerator, even within one file", () => {
    const entries = [
      ...Array.from({ length: 6 }, (_, index) => ({
        name: `caller${index}`,
        type: "function",
        filePath: "src/callers.ts",
      })),
      {
        name: "legacyCaller",
        type: "function",
        filePath: "src/callers.ts",
        edgeSource: "caller-candidate" as const,
      },
    ];
    const confirmedCount = filterConfirmedImpactDependencies(entries).length;
    const fileProxyCount = new Set(entries.map(({ filePath }) => filePath))
      .size;

    expect({ confirmedCount, fileProxyCount }).toEqual({
      confirmedCount: 6,
      fileProxyCount: 1,
    });
    expect(computeRiskLevelFromCounts(confirmedCount, 100)).toBe("HIGH");
    expect(computeRiskLevelFromCounts(fileProxyCount, 100)).toBe("MEDIUM");
  });

  it("matches excluded directory names at any path depth", () => {
    expect(hasPathSegment("backend/ee/onyx/task.py", "ee")).toBe(true);
    expect(hasPathSegment("backend/tests/unit/ee/test_task.py", "ee")).toBe(
      true,
    );
    expect(hasPathSegment("web/feeds/tenant.ts", "ee")).toBe(false);
  });

  it("recognizes minified and vendored bundles for separate review accounting", () => {
    expect(isExcludedBundlePath("code_review_graph/assets/d3.v7.min.js")).toBe(
      true,
    );
    expect(isExcludedBundlePath("web/assets/vendor/chart.js")).toBe(true);
    expect(isExcludedBundlePath("src/vendor/feature.ts")).toBe(true);
    expect(
      isExcludedBundlePath(
        "backend/tests/integration/tests/pruning/website/js/jquery.js",
      ),
    ).toBe(true);
    expect(
      isExcludedBundlePath(
        "backend/tests/integration/tests/pruning/website/js/jquery.fancybox.pack.js",
      ),
    ).toBe(true);
    expect(
      isExcludedBundlePath(
        "backend/tests/integration/tests/pruning/website/js/google-code-prettify/prettify.js",
      ),
    ).toBe(true);
    expect(isExcludedBundlePath("src/features/vendor-tool.ts")).toBe(false);
    expect(isExcludedBundlePath("src/features/target.ts")).toBe(false);

    const partition = partitionBundleReviewCandidates([
      {
        category: "other",
        sampleKey: "bundle",
        target: { file: "assets/vendor/chart.js" },
        addedCaller: { file: "src/caller.ts" },
      },
      {
        category: "other",
        sampleKey: "source",
        target: { file: "src/target.ts" },
        addedCaller: { file: "src/caller.ts" },
      },
    ]);
    expect(partition.bundleExcluded.map(({ sampleKey }) => sampleKey)).toEqual([
      "bundle",
    ]);
    expect(partition.reviewable.map(({ sampleKey }) => sampleKey)).toEqual([
      "source",
    ]);
  });

  it("[invalid-input] ignores unknown strata, non-positive sizes and non-finite deltas", () => {
    const candidates = [
      { category: "not-a-category", sampleKey: "x" },
      { category: "other", sampleKey: "a" },
    ];

    expect(selectSeededStratifiedSample(candidates, 5, "seed-3")).toEqual([
      { category: "other", sampleKey: "a" },
    ]);
    expect(selectSeededStratifiedSample(candidates, -1, "seed-3")).toEqual([]);
    expect(
      selectSeededStratifiedSample(candidates, Number.NaN, "seed-3"),
    ).toEqual([]);
    expect(distribution([Number.NaN, Number.POSITIVE_INFINITY])).toEqual({
      count: 0,
      median: null,
      p90: null,
      min: null,
      max: null,
    });
  });

  it("[error-handling] escapes regex metacharacters and tolerates missing evidence", () => {
    const source = ["const a = 1;", "  $get(a);", "  get(a);"].join("\n");

    expect(
      extractCallSiteEvidence(source, "$get", { startLine: 1, endLine: 3 }),
    ).toEqual(["1: const a = 1;\n2:   $get(a);\n3:   get(a);"]);
    expect(
      extractCallSiteEvidence(source, "(", { startLine: null, endLine: null }),
    ).toEqual([]);
    expect(limitSourceEvidence(null)).toBeNull();
  });

  it("limits long source lines in review evidence", () => {
    expect(limitSourceEvidence(`1: ${"x".repeat(20)}`, 12)).toBe(
      `1: ${"x".repeat(9)}… [line truncated]`,
    );
  });

  it("extracts target call sites from the added caller span", () => {
    const source = [
      "function target() {}",
      "function caller() {",
      "  target();",
      "}",
      "function unrelated() { target(); }",
    ].join("\n");

    expect(
      extractCallSiteEvidence(source, "target", {
        startLine: 2,
        endLine: 4,
      }),
    ).toEqual(["2: function caller() {\n3:   target();\n4: }"]);
  });
});
