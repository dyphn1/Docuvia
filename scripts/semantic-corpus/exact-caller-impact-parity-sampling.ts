import { createHash } from "node:crypto";

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
        rank: seededRank(seed, candidate.sampleKey),
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
  items: readonly { readonly category: string; readonly label?: string }[],
) {
  return Object.fromEntries(
    EXACT_CALLER_ADDITION_CATEGORIES.map((category) => {
      const selected = items.filter((item) => item.category === category);
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
