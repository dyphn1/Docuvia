import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
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
  computeSourceManifest,
  discoverSourceFiles,
  isSourceTreeDirty,
  recomputeAndVerifySourceManifest,
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

const SOURCE_DISCOVERY_OPTIONS = {
  excludedPathPrefixes: [],
  excludedPathSegments: [],
};

function withTemporaryGitSourceRepo<T>(run: (root: string) => T): T {
  const root = mkdtempSync(path.join(os.tmpdir(), "exact-caller-manifest-"));
  try {
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "src", "ee"), { recursive: true });
    mkdirSync(path.join(root, "src", "assets", "vendor"), {
      recursive: true,
    });
    writeFileSync(
      path.join(root, "src", "target.ts"),
      "export function target() { return 1; }\n",
    );
    writeFileSync(
      path.join(root, "src", "caller.ts"),
      'import { target } from "./target";\nexport function caller() { return target(); }\n',
    );
    writeFileSync(
      path.join(root, "src", "bindings.ts"),
      'import { target as selectedTarget } from "./target";\nexport const binding = selectedTarget;\n',
    );
    writeFileSync(
      path.join(root, "src", "ee", "legacy.ts"),
      "export const excludedLegacySource = true;\n",
    );
    writeFileSync(
      path.join(root, "src", "assets", "vendor", "chart.min.js"),
      "function chart(){return 1}\n",
    );
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "src"], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Manifest Test",
        "-c",
        "user.email=manifest-test@example.test",
        "commit",
        "-q",
        "-m",
        "fixture",
      ],
      { cwd: root },
    );
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function gitOutput(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function sourceManifest(root: string) {
  return computeSourceManifest(
    discoverSourceFiles(root, SOURCE_DISCOVERY_OPTIONS, false),
    SOURCE_DISCOVERY_OPTIONS,
  );
}

function reviewedManifestLabel(root: string, manifestSha256: string) {
  const headSha = gitOutput(root, ["rev-parse", "HEAD"]);
  const identity = buildRepositoryIdentity(null, root, headSha, manifestSha256);
  const sampleKey = buildExactCallerSampleKey(
    identity,
    "src/target.ts#target",
    "src/caller.ts#caller",
  );
  const evidence = {
    targetSnippet: "export function target() { return 1; }",
    addedCallerSnippet:
      'import { target } from "./target"; function caller() { return target(); }',
    callSiteSnippets: ["return target();"],
  };
  const evidenceFingerprint = buildEvidenceFingerprint(
    headSha,
    manifestSha256,
    "exact-enclosing-v2",
    evidence,
  );
  return {
    headSha,
    sampleKey,
    evidence,
    evidenceFingerprint,
    label: {
      sampleKey,
      evidenceFingerprint,
      label: "TP" as const,
      justification: "Reviewed source.",
      reviewed: true,
    },
  };
}

function samplerAuditFixture(root: string) {
  const manifest = sourceManifest(root);
  const headSha = gitOutput(root, ["rev-parse", "HEAD"]);
  const repositoryIdentity = buildRepositoryIdentity(
    null,
    root,
    headSha,
    manifest.manifestSha256,
  );
  const target = {
    symbol: "target",
    file: "src/target.ts",
    line: 1,
    endLine: 1,
    nodeKey: "src/target.ts#target",
  };
  const addedCaller = {
    symbol: "caller",
    file: "src/caller.ts",
    line: 2,
    endLine: 2,
    nodeKey: "src/caller.ts#caller",
  };
  const targetSnippet = "export function target() { return 1; }";
  const addedCallerSnippet =
    'import { target } from "./target"; function caller() { return target(); }';
  const callSiteSnippets = extractCallSiteEvidence(
    readFileSync(path.join(root, addedCaller.file), "utf8"),
    target.symbol,
    { startLine: addedCaller.line, endLine: addedCaller.endLine },
    3,
  ).map((snippet) => limitSourceEvidence(snippet, 500) ?? snippet);
  const sampleKey = buildExactCallerSampleKey(
    repositoryIdentity,
    target.nodeKey,
    addedCaller.nodeKey,
  );
  const evidenceFingerprint = buildEvidenceFingerprint(
    headSha,
    manifest.manifestSha256,
    "exact-enclosing-v2",
    {
      targetSnippet,
      addedCallerSnippet,
      callSiteSnippets,
    },
  );
  return {
    manifest,
    sampleKey,
    evidenceFingerprint,
    report: {
      repository: "manifest-fixture",
      repositoryRoot: root,
      repositoryIdentity,
      repositoryHeadSha: headSha,
      repositoryRemoteUrl: null,
      manifestSha256: manifest.manifestSha256,
      manifestFileCount: manifest.manifestFileCount,
      manifestDefinition: manifest.definition,
      sourceTreeDirty: false,
      excludedPathPrefixes: SOURCE_DISCOVERY_OPTIONS.excludedPathPrefixes,
      excludedPathSegments: SOURCE_DISCOVERY_OPTIONS.excludedPathSegments,
      policies: { candidate: "exact-enclosing-v2" },
      totals: { parsedFiles: manifest.manifestFileCount },
      additionCategoryCounts: { other: 1 },
      v2OnlyImpactAdditions: [
        {
          category: "other",
          sampleKey,
          samplingKey: "manifest-fixture-selection-key",
          repo: "manifest-fixture",
          target,
          addedCaller,
          evidence: {
            targetSnippet,
            addedCallerSnippet,
            directCallerSnippets: [],
          },
        },
      ],
      fileBlastRadiusDeltaRows: [],
    },
    labels: {
      sample: [
        {
          sampleKey,
          evidenceFingerprint,
          label: "TP",
          reviewed: true,
          justification: "The caller directly invokes the target.",
        },
      ],
    },
  };
}

function runSampler(root: string, report: unknown, labels: unknown) {
  const artifactRoot = mkdtempSync(
    path.join(os.tmpdir(), "exact-caller-sampler-output-"),
  );
  const inputPath = path.join(artifactRoot, "audit.json");
  const labelsPath = path.join(artifactRoot, "labels.json");
  const outputPath = path.join(artifactRoot, "sample.json");
  const samplerPath = path.resolve(
    process.cwd(),
    "scripts/semantic-corpus/exact-caller-impact-sample.mts",
  );
  try {
    writeFileSync(inputPath, JSON.stringify(report));
    writeFileSync(labelsPath, JSON.stringify(labels));
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        samplerPath,
        "--input",
        inputPath,
        "--out",
        outputPath,
        "--seed",
        "manifest-fixture-seed",
        "--sample-size",
        "1",
        "--labels-from",
        labelsPath,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    return JSON.parse(readFileSync(outputPath, "utf8")) as {
      readonly sample: readonly {
        readonly label: string;
        readonly reviewed: boolean;
      }[];
      readonly acceptanceGate: { readonly status: string };
    };
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true });
  }
}

function samplerErrorMessage(
  root: string,
  report: unknown,
  labels: unknown,
): string {
  try {
    runSampler(root, report, labels);
  } catch (error) {
    if (typeof error === "object" && error !== null && "stderr" in error) {
      return String(error.stderr);
    }
    return String(error);
  }
  return "sampler accepted a changed source tree";
}

describe("exact caller parity sampling", () => {
  it("[invalid-input] rejects an uncommitted import change and invalidates its TP label", () => {
    withTemporaryGitSourceRepo((root) => {
      const audit = samplerAuditFixture(root);
      const originalManifest = sourceManifest(root);
      const previous = reviewedManifestLabel(
        root,
        originalManifest.manifestSha256,
      );
      const originalTarget = readFileSync(
        path.join(root, "src", "target.ts"),
        "utf8",
      );
      const originalCaller = readFileSync(
        path.join(root, "src", "caller.ts"),
        "utf8",
      );

      writeFileSync(
        path.join(root, "src", "bindings.ts"),
        'import { target as competingTarget } from "./target";\nexport const binding = competingTarget;\n',
      );

      const changedManifest = sourceManifest(root);
      const currentIdentity = buildRepositoryIdentity(
        null,
        root,
        previous.headSha,
        changedManifest.manifestSha256,
      );
      const currentSampleKey = buildExactCallerSampleKey(
        currentIdentity,
        "src/target.ts#target",
        "src/caller.ts#caller",
      );
      const currentFingerprint = buildEvidenceFingerprint(
        previous.headSha,
        changedManifest.manifestSha256,
        "exact-enclosing-v2",
        previous.evidence,
      );
      const carriedLabel = findMatchingReviewLabel(
        [previous.label],
        currentSampleKey,
        currentFingerprint,
      );
      const eligibleCounts = { ...EMPTY_ELIGIBLE_COUNTS, other: 20 };
      const sample = [
        {
          category: "other" as const,
          sampleKey: currentSampleKey,
          label: carriedLabel?.label ?? ("unsure" as const),
          reviewed: carriedLabel !== undefined,
        },
      ];
      const weighted = estimatePopulationWeightedPrecision(
        eligibleCounts,
        sample,
      );

      expect(gitOutput(root, ["rev-parse", "HEAD"])).toBe(previous.headSha);
      expect(readFileSync(path.join(root, "src", "target.ts"), "utf8")).toBe(
        originalTarget,
      );
      expect(readFileSync(path.join(root, "src", "caller.ts"), "utf8")).toBe(
        originalCaller,
      );
      expect(isSourceTreeDirty(root)).toBe(true);
      expect(changedManifest.manifestSha256).not.toBe(
        originalManifest.manifestSha256,
      );
      expect(() =>
        recomputeAndVerifySourceManifest(
          root,
          "fixture",
          originalManifest,
          SOURCE_DISCOVERY_OPTIONS,
        ),
      ).toThrow("source tree changed since audit; re-run the audit");
      expect(carriedLabel).toEqual(undefined);
      expect(
        evaluateAcceptanceGate(eligibleCounts, sample, weighted).status,
      ).toBe("inconclusive");
      expect(samplerErrorMessage(root, audit.report, audit.labels)).toContain(
        "source tree changed since audit; re-run the audit",
      );
    });
  });

  it("[invalid-input] rejects an untracked competing declaration in the manifest", () => {
    withTemporaryGitSourceRepo((root) => {
      const audit = samplerAuditFixture(root);
      const originalManifest = sourceManifest(root);
      const previous = reviewedManifestLabel(
        root,
        originalManifest.manifestSha256,
      );

      writeFileSync(
        path.join(root, "src", "competitor.ts"),
        "export function target() { return 2; }\n",
      );

      const changedManifest = sourceManifest(root);

      expect(gitOutput(root, ["rev-parse", "HEAD"])).toBe(previous.headSha);
      expect(isSourceTreeDirty(root)).toBe(true);
      expect(changedManifest.manifestFileCount).toBe(
        originalManifest.manifestFileCount + 1,
      );
      expect(changedManifest.manifestSha256).not.toBe(
        originalManifest.manifestSha256,
      );
      expect(() =>
        recomputeAndVerifySourceManifest(
          root,
          "fixture",
          originalManifest,
          SOURCE_DISCOVERY_OPTIONS,
        ),
      ).toThrow("source tree changed since audit; re-run the audit");
      expect(samplerErrorMessage(root, audit.report, audit.labels)).toContain(
        "source tree changed since audit; re-run the audit",
      );
    });
  });

  it("[happy] carries a TP label for a committed-clean unchanged manifest", () => {
    withTemporaryGitSourceRepo((root) => {
      const audit = samplerAuditFixture(root);
      const auditedManifest = sourceManifest(root);
      const previous = reviewedManifestLabel(
        root,
        auditedManifest.manifestSha256,
      );
      const currentManifest = recomputeAndVerifySourceManifest(
        root,
        "fixture",
        auditedManifest,
        SOURCE_DISCOVERY_OPTIONS,
      );
      const currentIdentity = buildRepositoryIdentity(
        null,
        root,
        previous.headSha,
        currentManifest.manifestSha256,
      );
      const sampleKey = buildExactCallerSampleKey(
        currentIdentity,
        "src/target.ts#target",
        "src/caller.ts#caller",
      );
      const fingerprint = buildEvidenceFingerprint(
        previous.headSha,
        currentManifest.manifestSha256,
        "exact-enclosing-v2",
        previous.evidence,
      );
      const carriedLabel = findMatchingReviewLabel(
        [previous.label],
        sampleKey,
        fingerprint,
      );
      const eligibleCounts = { ...EMPTY_ELIGIBLE_COUNTS, other: 1 };
      const sample = [
        {
          category: "other" as const,
          sampleKey,
          label: carriedLabel?.label ?? ("unsure" as const),
          reviewed: carriedLabel !== undefined,
        },
      ];
      const weighted = estimatePopulationWeightedPrecision(
        eligibleCounts,
        sample,
      );

      expect(isSourceTreeDirty(root)).toBe(false);
      expect(carriedLabel?.label).toBe("TP");
      expect(
        evaluateAcceptanceGate(eligibleCounts, sample, weighted).status,
      ).toBe("pass");
      const sampledReview = runSampler(root, audit.report, audit.labels);
      expect(sampledReview.sample).toMatchObject([
        { label: "TP", reviewed: true },
      ]);
      expect(sampledReview.acceptanceGate.status).toBe("pass");
    });
  });

  it("[happy] records path exclusions and minified label handling in the manifest", () => {
    withTemporaryGitSourceRepo((root) => {
      const allSourceManifest = sourceManifest(root);
      const onyxOptions = {
        excludedPathPrefixes: [],
        excludedPathSegments: ["ee"],
      };
      const onyxFiles = discoverSourceFiles(root, onyxOptions, false);
      const onyxManifest = computeSourceManifest(onyxFiles, onyxOptions);

      expect(onyxManifest.manifestFileCount).toBe(4);
      expect(onyxManifest.manifestSha256).not.toBe(
        allSourceManifest.manifestSha256,
      );
      expect(onyxFiles.map(({ file }) => file)).not.toContain(
        "src/ee/legacy.ts",
      );
      expect(onyxFiles.map(({ file }) => file)).toContain(
        "src/assets/vendor/chart.min.js",
      );
      expect(onyxManifest.definition.excludedPathSegments).toEqual(["ee"]);
      expect(onyxManifest.definition.bundleHandling).toContain(
        "excluded only from precision labels",
      );
      expect(isExcludedBundlePath("src/assets/vendor/chart.min.js")).toBe(true);
    });
  });

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
      "manifest-1",
    );
    const sampleKey = buildExactCallerSampleKey(
      repositoryIdentity,
      "target-node",
      "caller-node",
    );
    const originalFingerprint = buildEvidenceFingerprint(
      "head-1",
      "manifest-1",
      "exact-enclosing-v2",
      {
        targetSnippet: "function target() {}",
        addedCallerSnippet: "function caller() { target(); }",
        callSiteSnippets: ["target();"],
      },
    );
    const changedFingerprint = buildEvidenceFingerprint(
      "head-1",
      "manifest-1",
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
      "manifest-one",
    );
    const secondIdentity = buildRepositoryIdentity(
      null,
      "/audit/two/shared",
      "head-two",
      "manifest-two",
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
