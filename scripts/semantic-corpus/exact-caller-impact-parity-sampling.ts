import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  isDiscoverableSourceFile,
  MAX_FILE_SIZE_BYTES,
} from "../../lib/contracts/src/index.js";

export interface SourceDiscoveryOptions {
  readonly excludedPathPrefixes: readonly string[];
  readonly excludedPathSegments: readonly string[];
}

export interface DiscoveredSourceFile {
  readonly file: string;
  readonly hash: string;
  readonly code?: string;
}

export interface DiscoveredSourceFileWithCode extends DiscoveredSourceFile {
  readonly code: string;
}

export interface SourceManifest {
  readonly manifestSha256: string;
  readonly manifestFileCount: number;
  readonly definition: {
    readonly fileListing: string;
    readonly sourcePredicate: string;
    readonly maxFileSizeBytes: number;
    readonly excludedPathPrefixes: readonly string[];
    readonly excludedPathSegments: readonly string[];
    readonly bundleHandling: string;
  };
}

function normalizedSourcePath(file: string): string {
  return file.replaceAll("\\", "/");
}

function sourcePathIsExcluded(
  file: string,
  options: SourceDiscoveryOptions,
): boolean {
  const relativeFile = normalizedSourcePath(file);
  return (
    options.excludedPathPrefixes.some((prefix) =>
      relativeFile.startsWith(normalizedSourcePath(prefix)),
    ) ||
    options.excludedPathSegments.some((segment) =>
      hasPathSegment(relativeFile, segment),
    )
  );
}

function readDiscoveredSourceFile(
  root: string,
  file: string,
  includeCode: boolean,
): DiscoveredSourceFile | undefined {
  const absolutePath = path.resolve(root, file);
  let fileDescriptor: number;
  try {
    fileDescriptor = openSync(absolutePath, "r");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
  try {
    if (fstatSync(fileDescriptor).size > MAX_FILE_SIZE_BYTES) return undefined;
    const bytes = readFileSync(fileDescriptor);
    return {
      file: normalizedSourcePath(file),
      hash: createHash("sha256").update(bytes).digest("hex"),
      ...(includeCode ? { code: bytes.toString("utf8") } : {}),
    };
  } finally {
    closeSync(fileDescriptor);
  }
}

/** Lists and reads exactly the tracked plus non-ignored untracked source files the audit parses. */
export function discoverSourceFiles(
  root: string,
  options: SourceDiscoveryOptions,
): DiscoveredSourceFileWithCode[];
export function discoverSourceFiles(
  root: string,
  options: SourceDiscoveryOptions,
  includeCode: true,
): DiscoveredSourceFileWithCode[];
export function discoverSourceFiles(
  root: string,
  options: SourceDiscoveryOptions,
  includeCode: false,
): DiscoveredSourceFile[];
export function discoverSourceFiles(
  root: string,
  options: SourceDiscoveryOptions,
  includeCode = true,
): DiscoveredSourceFile[] {
  const listedFiles = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root },
  )
    .toString("utf8")
    .split("\0");
  const files: DiscoveredSourceFile[] = [];
  for (const file of listedFiles) {
    if (!file || !isDiscoverableSourceFile(file)) continue;
    if (sourcePathIsExcluded(file, options)) continue;
    const sourceFile = readDiscoveredSourceFile(root, file, includeCode);
    if (sourceFile) files.push(sourceFile);
  }
  return files.sort((left, right) =>
    left.file < right.file ? -1 : left.file > right.file ? 1 : 0,
  );
}

/** Hashes sorted relative-path/content pairs plus the effective discovery rules. */
export function computeSourceManifest(
  sourceFiles: readonly DiscoveredSourceFile[],
  options: SourceDiscoveryOptions,
): SourceManifest {
  const definition = {
    fileListing: "git ls-files --cached --others --exclude-standard -z",
    sourcePredicate: "isDiscoverableSourceFile",
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    excludedPathPrefixes: options.excludedPathPrefixes
      .map(normalizedSourcePath)
      .sort(),
    excludedPathSegments: [...options.excludedPathSegments].sort(),
    bundleHandling:
      "isExcludedBundlePath files stay in the parsed manifest and are excluded only from precision labels",
  } as const;
  const files = sourceFiles
    .map(
      ({ file, hash }) =>
        [normalizedSourcePath(file), hash, isExcludedBundlePath(file)] as const,
    )
    .sort(([leftPath], [rightPath]) =>
      leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0,
    );
  const manifestSha256 = createHash("sha256")
    .update(JSON.stringify({ definition, files }))
    .digest("hex");
  return {
    manifestSha256,
    manifestFileCount: files.length,
    definition,
  };
}

export function assertSourceManifestMatches(
  repository: string,
  auditedManifest: SourceManifest,
  currentManifest: SourceManifest,
): void {
  if (
    auditedManifest.manifestSha256 === currentManifest.manifestSha256 &&
    auditedManifest.manifestFileCount === currentManifest.manifestFileCount
  ) {
    return;
  }
  throw new Error(
    `source tree changed since audit; re-run the audit for ${repository} (manifest ${auditedManifest.manifestSha256}/${auditedManifest.manifestFileCount} files, current ${currentManifest.manifestSha256}/${currentManifest.manifestFileCount} files)`,
  );
}

/** Recomputes the exact audit source set before a sampler trusts report metadata. */
export function recomputeAndVerifySourceManifest(
  repositoryRoot: string,
  repository: string,
  auditedManifest: SourceManifest,
  options: SourceDiscoveryOptions,
): SourceManifest {
  const currentManifest = computeSourceManifest(
    discoverSourceFiles(repositoryRoot, options, false),
    options,
  );
  assertSourceManifestMatches(repository, auditedManifest, currentManifest);
  return currentManifest;
}

export function isSourceTreeDirty(repositoryRoot: string): boolean {
  return (
    execFileSync("git", ["status", "--porcelain"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim().length > 0
  );
}

export const EXACT_CALLER_ADDITION_CATEGORIES = [
  "anonymous-callback/lexical-parent",
  "ambiguous-spans",
  "class-ownership",
  "caller-candidate",
  "other",
] as const;

export type ExactCallerAdditionCategory =
  (typeof EXACT_CALLER_ADDITION_CATEGORIES)[number];

export interface SampleCandidate {
  readonly category: ExactCallerAdditionCategory;
  readonly sampleKey: string;
  /** Stable review-selection key retained across the audit-identity migration. */
  readonly samplingKey?: string;
}

export type ReviewLabel = "TP" | "FP" | "unsure";

export interface ReviewLabelProvenance {
  readonly sampleKey: string;
  readonly evidenceFingerprint?: string;
  readonly label: ReviewLabel;
  readonly justification: string;
  readonly reviewed?: boolean;
}

export interface ReviewEvidence {
  readonly targetSnippet: string | null;
  readonly addedCallerSnippet: string | null;
  readonly callSiteSnippets: readonly string[];
}

export function buildRepositoryIdentity(
  remoteUrl: string | null,
  repositoryRoot: string,
  headSha: string,
  manifestSha256: string,
): string {
  const source = remoteUrl?.trim()
    ? `remote:${remoteUrl.trim()}`
    : `root:${path.resolve(repositoryRoot)}`;
  return `${source}\0${headSha.trim()}\0${manifestSha256.trim()}`;
}

export function buildExactCallerSampleKey(
  repositoryIdentity: string,
  targetNodeKey: string,
  addedCallerNodeKey: string,
): string {
  return JSON.stringify([
    repositoryIdentity,
    targetNodeKey,
    addedCallerNodeKey,
  ]);
}

export function buildEvidenceFingerprint(
  repositoryHeadSha: string,
  manifestSha256: string,
  callerPolicy: string,
  evidence: ReviewEvidence,
): string {
  const canonicalEvidence = JSON.stringify({
    repositoryHeadSha,
    manifestSha256,
    callerPolicy,
    targetSnippet: evidence.targetSnippet,
    addedCallerSnippet: evidence.addedCallerSnippet,
    callSiteSnippets: [...evidence.callSiteSnippets],
  });
  return createHash("sha256").update(canonicalEvidence).digest("hex");
}

export function assertUniqueRepositoryIdentities(
  repositories: readonly {
    readonly repository: string;
    readonly identity: string;
  }[],
): void {
  const repositoryByIdentity = new Map<string, string>();
  for (const { repository, identity } of repositories) {
    const previousRepository = repositoryByIdentity.get(identity);
    if (previousRepository !== undefined) {
      throw new Error(
        `Duplicate repository audit identity for ${previousRepository} and ${repository}: ${identity}`,
      );
    }
    repositoryByIdentity.set(identity, repository);
  }
}

export function indexAuditsByIdentity<
  T extends {
    readonly repository: string;
    readonly repositoryIdentity: string;
  },
>(reports: readonly T[]): ReadonlyMap<string, T> {
  assertUniqueRepositoryIdentities(
    reports.map(({ repository, repositoryIdentity }) => ({
      repository,
      identity: repositoryIdentity,
    })),
  );
  return new Map(
    reports.map((report) => [report.repositoryIdentity, report] as const),
  );
}

export function findMatchingReviewLabel(
  labels: readonly ReviewLabelProvenance[],
  sampleKey: string,
  evidenceFingerprint: string,
): ReviewLabelProvenance | undefined {
  const matching = labels.filter(
    (label) =>
      label.sampleKey === sampleKey &&
      label.evidenceFingerprint === evidenceFingerprint &&
      label.reviewed !== false,
  );
  if (matching.length > 1) {
    throw new Error(
      `Duplicate review-label provenance for sample ${sampleKey}`,
    );
  }
  return matching[0];
}

export interface LabeledSampleCandidate extends SampleCandidate {
  readonly label: ReviewLabel;
  /** False means the artifact contains a placeholder label that was not source-reviewed. */
  readonly reviewed?: boolean;
}

export type EligibleCounts = Record<ExactCallerAdditionCategory, number>;

export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
}

export interface PopulationWeightedPrecisionEstimate {
  readonly eligibleCount: number;
  readonly estimate: number | null;
  readonly interval: {
    readonly confidenceLevel: 0.95;
    readonly method: string;
    readonly lower: number | null;
    readonly upper: number | null;
  };
  readonly strata: Record<
    ExactCallerAdditionCategory,
    {
      readonly eligibleCount: number;
      readonly sampleCount: number;
      readonly truePositives: number;
      readonly falsePositives: number;
      readonly unsure: number;
      readonly conservativePrecision: number | null;
      readonly weight: number;
      readonly interval: ConfidenceInterval | null;
      readonly intervalMethod: "exact-census" | "wilson-99-bonferroni" | null;
    }
  >;
}

export interface AcceptanceGateResult {
  readonly status: "pass" | "fail" | "inconclusive";
  readonly coverageSufficient: boolean;
  readonly insufficientCoverageCategories: ExactCallerAdditionCategory[];
  readonly overallThreshold: 0.9;
  readonly categoryThreshold: 0.8;
  readonly weightedLowerBound: number | null;
  readonly categoryFloors: Record<
    ExactCallerAdditionCategory,
    {
      readonly applies: boolean;
      readonly eligibleCount: number;
      readonly reviewedCount: number;
      readonly conservativePrecision: number | null;
      readonly passes: boolean;
    }
  >;
}

export interface NumericDistribution {
  readonly count: number;
  readonly median: number | null;
  readonly p90: number | null;
  readonly min: number | null;
  readonly max: number | null;
}

export function hasPathSegment(filePath: string, segment: string): boolean {
  return filePath.replaceAll("\\", "/").split("/").includes(segment);
}

/** Minified and vendored sources are counted but excluded from source precision labels. */
export function isExcludedBundlePath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? "";
  const sourceExtension = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/;
  const isMinified = /\.min\.(?:cjs|js|jsx|mjs|ts|tsx)$/.test(basename);
  const isBundle =
    /\.(?:bundle|chunk)(?:[-.][a-z0-9_-]+)?\.(?:cjs|js|jsx|mjs|ts|tsx)$/.test(
      basename,
    );
  const isKnownVendorLibrary =
    /^(?:jquery|bootstrap|prettify)(?:[.-][a-z0-9_.-]*)?\.(?:cjs|js|jsx|mjs|ts|tsx)$/.test(
      basename,
    );
  const hasVendorDirectory = segments.some((segment) =>
    [
      "node_modules",
      "third-party",
      "third_party",
      "vendor",
      "vendors",
    ].includes(segment),
  );
  return (
    (sourceExtension.test(basename) &&
      (isMinified || isBundle || isKnownVendorLibrary)) ||
    hasVendorDirectory
  );
}

export function partitionBundleReviewCandidates<
  T extends SampleCandidate & {
    readonly target: { readonly file: string };
    readonly addedCaller: { readonly file: string };
  },
>(
  candidates: readonly T[],
): {
  readonly reviewable: T[];
  readonly bundleExcluded: T[];
} {
  const reviewable: T[] = [];
  const bundleExcluded: T[] = [];
  for (const candidate of candidates) {
    const isExcluded =
      isExcludedBundlePath(candidate.target.file) ||
      isExcludedBundlePath(candidate.addedCaller.file);
    (isExcluded ? bundleExcluded : reviewable).push(candidate);
  }
  return { reviewable, bundleExcluded };
}

/** Keeps minified or generated source lines from overwhelming review artifacts. */
export function limitSourceEvidence(
  snippet: string | null,
  maxLineLength = 500,
): string | null {
  if (snippet === null) return null;
  return snippet
    .split("\n")
    .map((line) =>
      line.length > maxLineLength
        ? `${line.slice(0, maxLineLength)}… [line truncated]`
        : line,
    )
    .join("\n");
}

/** Finds target-name call expressions inside the added caller's source span. */
export function extractCallSiteEvidence(
  source: string,
  targetSymbol: string,
  span: { readonly startLine: number | null; readonly endLine: number | null },
  maxMatches = 3,
): string[] {
  const escapedName = targetSymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `\b` cannot anchor names that start with `$`, so require a non-identifier character instead.
  // This evidence heuristic accepts one generic-argument level; nested generic calls are
  // intentionally unmatched rather than using a backtracking-prone nested pattern.
  const callPattern = new RegExp(
    `(?<![\\w$])${escapedName}\\s*(?:<[^>]*>)?\\s*\\(`,
  );
  const lines = source.split("\n");
  const matchingLineIndexes = lines.flatMap((line, index) => {
    const lineNumber = index + 1;
    if (
      !callPattern.test(line) ||
      (span.startLine !== null && lineNumber < span.startLine) ||
      (span.endLine !== null && lineNumber > span.endLine)
    ) {
      return [];
    }
    return [index];
  });
  return matchingLineIndexes.slice(0, Math.max(0, maxMatches)).map((index) => {
    const firstLine = Math.max(0, index - 1);
    const lastLine = Math.min(lines.length, index + 2);
    return lines
      .slice(firstLine, lastLine)
      .map((line, lineIndex) => `${firstLine + lineIndex + 1}: ${line}`)
      .join("\n");
  });
}

function seededRank(seed: string, sampleKey: string): string {
  return createHash("sha256").update(`${seed}\0${sampleKey}`).digest("hex");
}

/** Selects a balanced sample in category order, using a stable seeded hash within each stratum. */
export function selectSeededStratifiedSample<T extends SampleCandidate>(
  candidates: readonly T[],
  sampleSize: number,
  seed: string,
): T[] {
  const wanted = Math.max(0, Math.floor(sampleSize));
  const buckets = EXACT_CALLER_ADDITION_CATEGORIES.map((category) =>
    candidates
      .filter((candidate) => candidate.category === category)
      .map((candidate) => ({
        candidate,
        rank: seededRank(seed, candidate.samplingKey ?? candidate.sampleKey),
      }))
      .sort(
        (left, right) =>
          left.rank.localeCompare(right.rank) ||
          left.candidate.sampleKey.localeCompare(right.candidate.sampleKey),
      )
      .map(({ candidate }) => candidate),
  );
  const offsets = buckets.map(() => 0);
  const sample: T[] = [];

  while (sample.length < wanted) {
    let addedInRound = false;
    for (
      let index = 0;
      index < buckets.length && sample.length < wanted;
      index++
    ) {
      const candidate = buckets[index]?.[offsets[index] ?? 0];
      if (candidate === undefined) continue;
      sample.push(candidate);
      offsets[index] = (offsets[index] ?? 0) + 1;
      addedInRound = true;
    }
    if (!addedInRound) break;
  }

  return sample;
}

/** Uses the median and nearest-rank p90 so small corpus distributions stay reproducible. */
export function distribution(values: readonly number[]): NumericDistribution {
  const sorted = values
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) {
    return { count: 0, median: null, p90: null, min: null, max: null };
  }
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  const p90Index = Math.ceil(sorted.length * 0.9) - 1;
  return {
    count: sorted.length,
    median,
    p90: sorted[p90Index] ?? sorted[sorted.length - 1] ?? null,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
  };
}

export function labelCounts(
  items: readonly {
    readonly category: string;
    readonly label?: string;
    readonly reviewed?: boolean;
  }[],
) {
  return Object.fromEntries(
    EXACT_CALLER_ADDITION_CATEGORIES.map((category) => {
      const selected = items.filter(
        (item) =>
          item.category === category &&
          item.reviewed !== false &&
          item.label !== undefined,
      );
      const truePositives = selected.filter(
        (item) => item.label === "TP",
      ).length;
      const falsePositives = selected.filter(
        (item) => item.label === "FP",
      ).length;
      const unsure = selected.filter((item) => item.label === "unsure").length;
      const judged = truePositives + falsePositives;
      return [
        category,
        {
          sampleCount: selected.length,
          truePositives,
          falsePositives,
          unsure,
          judgedPrecision: judged === 0 ? null : truePositives / judged,
          conservativePrecision:
            selected.length === 0 ? null : truePositives / selected.length,
        },
      ];
    }),
  );
}

const WILSON_99_BONFERRONI_Z = 2.5758293035489004;

function wilsonInterval99(
  successes: number,
  trials: number,
): ConfidenceInterval {
  const zSquared = WILSON_99_BONFERRONI_Z ** 2;
  const proportion = successes / trials;
  const denominator = 1 + zSquared / trials;
  const center = (proportion + zSquared / (2 * trials)) / denominator;
  const margin =
    (WILSON_99_BONFERRONI_Z / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / trials +
        zSquared / (4 * trials * trials),
    );
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

function labelCountsByCategory(
  sample: readonly LabeledSampleCandidate[],
): ReturnType<typeof labelCounts> {
  return labelCounts(sample);
}

/** Estimates reviewable-population precision from category-specific rates and eligible counts. */
export function estimatePopulationWeightedPrecision(
  eligibleCounts: EligibleCounts,
  sample: readonly LabeledSampleCandidate[],
): PopulationWeightedPrecisionEstimate {
  const totalEligible = EXACT_CALLER_ADDITION_CATEGORIES.reduce(
    (total, category) => total + eligibleCounts[category],
    0,
  );
  const counts = labelCountsByCategory(sample);
  const strata = Object.fromEntries(
    EXACT_CALLER_ADDITION_CATEGORIES.map((category) => {
      const eligibleCount = eligibleCounts[category];
      const categoryCounts = counts[category];
      const sampleCount = categoryCounts.sampleCount;
      const conservativePrecision = categoryCounts.conservativePrecision;
      const interval =
        sampleCount === 0 || conservativePrecision === null
          ? null
          : sampleCount === eligibleCount
            ? {
                lower: conservativePrecision,
                upper: conservativePrecision,
              }
            : wilsonInterval99(categoryCounts.truePositives, sampleCount);
      return [
        category,
        {
          eligibleCount,
          sampleCount,
          truePositives: categoryCounts.truePositives,
          falsePositives: categoryCounts.falsePositives,
          unsure: categoryCounts.unsure,
          conservativePrecision,
          weight: totalEligible === 0 ? 0 : eligibleCount / totalEligible,
          interval,
          intervalMethod:
            interval === null
              ? null
              : sampleCount === eligibleCount
                ? "exact-census"
                : "wilson-99-bonferroni",
        },
      ];
    }),
  ) as PopulationWeightedPrecisionEstimate["strata"];

  const isEstimable =
    totalEligible > 0 &&
    EXACT_CALLER_ADDITION_CATEGORIES.every(
      (category) =>
        eligibleCounts[category] === 0 || strata[category].sampleCount > 0,
    );
  if (!isEstimable) {
    return {
      eligibleCount: totalEligible,
      estimate: null,
      interval: {
        confidenceLevel: 0.95,
        method:
          "Weighted 99% Wilson stratum bounds with Bonferroni correction across five categories; census strata use exact bounds; no finite-population correction.",
        lower: null,
        upper: null,
      },
      strata,
    };
  }

  const estimate = EXACT_CALLER_ADDITION_CATEGORIES.reduce(
    (total, category) =>
      total +
      strata[category].weight * (strata[category].conservativePrecision ?? 0),
    0,
  );
  const intervalsComplete = EXACT_CALLER_ADDITION_CATEGORIES.every(
    (category) =>
      eligibleCounts[category] === 0 || strata[category].interval !== null,
  );
  const lower = intervalsComplete
    ? EXACT_CALLER_ADDITION_CATEGORIES.reduce(
        (total, category) =>
          total +
          strata[category].weight * (strata[category].interval?.lower ?? 0),
        0,
      )
    : null;
  const upper = intervalsComplete
    ? EXACT_CALLER_ADDITION_CATEGORIES.reduce(
        (total, category) =>
          total +
          strata[category].weight * (strata[category].interval?.upper ?? 0),
        0,
      )
    : null;
  return {
    eligibleCount: totalEligible,
    estimate,
    interval: {
      confidenceLevel: 0.95,
      method:
        "Weighted 99% Wilson stratum bounds with Bonferroni correction across five categories; census strata use exact bounds; no finite-population correction.",
      lower,
      upper,
    },
    strata,
  };
}

/** Applies reviewed-sample coverage requirements before allowing a pass/fail precision decision. */
export function evaluateAcceptanceGate(
  eligibleCounts: EligibleCounts,
  sample: readonly LabeledSampleCandidate[],
  populationWeightedPrecision: PopulationWeightedPrecisionEstimate,
): AcceptanceGateResult {
  const counts = labelCountsByCategory(sample);
  const insufficientCoverageCategories =
    EXACT_CALLER_ADDITION_CATEGORIES.filter((category) => {
      const eligibleCount = eligibleCounts[category];
      const reviewedCount = counts[category].sampleCount;
      return eligibleCount >= 10
        ? reviewedCount < 10
        : reviewedCount !== eligibleCount;
    });
  const categoryFloors = Object.fromEntries(
    EXACT_CALLER_ADDITION_CATEGORIES.map((category) => {
      const eligibleCount = eligibleCounts[category];
      const categoryCounts = counts[category];
      const applies = eligibleCount >= 10;
      const passes =
        !applies ||
        (categoryCounts.conservativePrecision !== null &&
          categoryCounts.conservativePrecision >= 0.8);
      return [
        category,
        {
          applies,
          eligibleCount,
          reviewedCount: categoryCounts.sampleCount,
          conservativePrecision: categoryCounts.conservativePrecision,
          passes,
        },
      ];
    }),
  ) as AcceptanceGateResult["categoryFloors"];
  const coverageSufficient =
    insufficientCoverageCategories.length === 0 &&
    populationWeightedPrecision.eligibleCount > 0;
  const precisionPasses =
    populationWeightedPrecision.interval.lower !== null &&
    populationWeightedPrecision.interval.lower >= 0.9 &&
    Object.values(categoryFloors).every(({ passes }) => passes);
  return {
    status: !coverageSufficient
      ? "inconclusive"
      : precisionPasses
        ? "pass"
        : "fail",
    coverageSufficient,
    insufficientCoverageCategories,
    overallThreshold: 0.9,
    categoryThreshold: 0.8,
    weightedLowerBound: populationWeightedPrecision.interval.lower,
    categoryFloors,
  };
}
