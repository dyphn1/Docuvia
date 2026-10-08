import { describe, expect, it } from "vitest";
import {
  EXACT_CALLER_ADDITION_CATEGORIES,
  distribution,
  extractCallSiteEvidence,
  hasPathSegment,
  isExcludedBundlePath,
  labelCounts,
  limitSourceEvidence,
  partitionBundleReviewCandidates,
  selectSeededStratifiedSample,
} from "../scripts/semantic-corpus/exact-caller-impact-parity-sampling.js";

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
