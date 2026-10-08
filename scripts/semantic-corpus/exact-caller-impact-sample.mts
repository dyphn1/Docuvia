import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  distribution,
  EXACT_CALLER_ADDITION_CATEGORIES,
  extractCallSiteEvidence,
  limitSourceEvidence,
  labelCounts,
  selectSeededStratifiedSample,
  partitionBundleReviewCandidates,
  type ExactCallerAdditionCategory,
  type SampleCandidate,
} from "./exact-caller-impact-parity-sampling.js";

type Location = {
  readonly symbol: string;
  readonly file: string;
  readonly line: number | null;
  readonly endLine: number | null;
  readonly nodeKey: string;
};

type AdditionReviewItem = SampleCandidate & {
  readonly repo: string;
  readonly target: Location;
  readonly addedCaller: Location;
  readonly evidence: {
    readonly targetSnippet: string | null;
    readonly addedCallerSnippet: string | null;
    readonly directCallerSnippets: Array<{
      readonly caller: Location;
      readonly snippet: string | null;
    }>;
  };
};

type AuditReport = {
  readonly repository: string;
  readonly repositoryRoot: string;
  readonly excludedPathPrefixes?: readonly string[];
  readonly excludedPathSegments?: readonly string[];
  readonly totals: Record<string, number>;
  readonly additionCategoryCounts: Record<string, number>;
  readonly v2OnlyImpactAdditions: readonly AdditionReviewItem[];
  readonly fileBlastRadiusDeltaRows: readonly {
    readonly target: Location;
    readonly v1ImpactedFiles: number;
    readonly v2ImpactedFiles: number;
    readonly delta: number;
    readonly v1RiskLevel: string;
    readonly v2RiskLevel: string;
  }[];
  readonly worstFileLevelDropDetails?: readonly {
    readonly target: Location;
    readonly delta: number;
    readonly v1ImpactedFiles: number;
    readonly v2ImpactedFiles: number;
    readonly v1OnlyFilePaths: readonly string[];
    readonly v2OnlyFilePaths: readonly string[];
    readonly v1IncomingLinkTypeCounts: Readonly<Record<string, number>>;
    readonly v2IncomingLinkTypeCounts: Readonly<Record<string, number>>;
    readonly v1DirectCallerCount: number;
    readonly v2DirectCallerCount: number;
    readonly v1DirectCallerSample: readonly string[];
    readonly v2DirectCallerSample: readonly string[];
  }[];
};

type Options = {
  readonly inputs: readonly string[];
  readonly outputPath: string;
  readonly seed: string;
  readonly sampleSize: number;
  readonly labelsPath?: string;
};

function parseOptions(argv: readonly string[]): Options {
  const inputs: string[] = [];
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      ![
        "--input",
        "--out",
        "--seed",
        "--sample-size",
        "--labels-from",
      ].includes(key ?? "") ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error(
        "Usage: exact-caller-impact-sample.mts --input <audit.json>... --out <review.json> --seed <seed> --sample-size <count> [--labels-from <review.json>]",
      );
    }
    if (key === "--input") {
      inputs.push(path.resolve(value));
      continue;
    }
    values.set(key, value);
  }
  const outputPath = values.get("--out");
  const seed = values.get("--seed");
  const sampleSizeValue = Number(values.get("--sample-size"));
  const labelsPath = values.get("--labels-from");
  if (
    inputs.length === 0 ||
    !outputPath ||
    !seed ||
    !Number.isSafeInteger(sampleSizeValue) ||
    sampleSizeValue < 0
  ) {
    throw new Error(
      "Usage: exact-caller-impact-sample.mts --input <audit.json>... --out <review.json> --seed <seed> --sample-size <count> [--labels-from <review.json>]",
    );
  }
  return {
    inputs,
    outputPath: path.resolve(outputPath),
    seed,
    sampleSize: sampleSizeValue,
    ...(labelsPath ? { labelsPath: path.resolve(labelsPath) } : {}),
  };
}

function readAuditReport(filePath: string): AuditReport {
  const report = JSON.parse(readFileSync(filePath, "utf8")) as AuditReport;
  if (
    !report.repository ||
    !report.repositoryRoot ||
    !Array.isArray(report.v2OnlyImpactAdditions) ||
    !Array.isArray(report.fileBlastRadiusDeltaRows)
  ) {
    throw new Error(`Invalid parity audit report: ${filePath}`);
  }
  return report;
}

function callerCallSiteSnippets(
  repositoryRoot: string,
  item: AdditionReviewItem,
): string[] {
  const root = path.resolve(repositoryRoot);
  const sourcePath = path.resolve(root, item.addedCaller.file);
  const relativePath = path.relative(root, sourcePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `Added caller path escapes its repository: ${item.addedCaller.file}`,
    );
  }
  const source = readFileSync(sourcePath, "utf8");
  return extractCallSiteEvidence(
    source,
    item.target.symbol,
    {
      startLine: item.addedCaller.line,
      endLine: item.addedCaller.endLine,
    },
    3,
  ).map((snippet) => limitSourceEvidence(snippet, 500) ?? snippet);
}

function addTotals(reports: readonly AuditReport[]) {
  const keys = new Set(reports.flatMap((report) => Object.keys(report.totals)));
  return Object.fromEntries(
    [...keys]
      .sort()
      .map((key) => [
        key,
        reports.reduce((total, report) => total + (report.totals[key] ?? 0), 0),
      ]),
  );
}

function categoryCounts(
  items: readonly AdditionReviewItem[],
  key: "category" | "label",
) {
  const counts = Object.fromEntries(
    EXACT_CALLER_ADDITION_CATEGORIES.map((category) => [category, 0]),
  ) as Record<ExactCallerAdditionCategory, number>;
  for (const item of items) {
    if (key === "category") counts[item.category] += 1;
  }
  return counts;
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const reports = options.inputs.map(readAuditReport);
  const reportsByRepository = new Map(
    reports.map((report) => [report.repository, report] as const),
  );
  const candidates = reports.flatMap((report) => report.v2OnlyImpactAdditions);
  const { reviewable: reviewableCandidates, bundleExcluded } =
    partitionBundleReviewCandidates(candidates);
  const selected = selectSeededStratifiedSample(
    reviewableCandidates,
    options.sampleSize,
    options.seed,
  );
  const labelsBySampleKey = new Map<
    string,
    { readonly label: string; readonly justification: string }
  >();
  if (options.labelsPath) {
    const prior = JSON.parse(readFileSync(options.labelsPath, "utf8")) as {
      readonly sample?: readonly {
        readonly sampleKey: string;
        readonly label: string;
        readonly justification: string;
      }[];
    };
    for (const item of prior.sample ?? []) {
      labelsBySampleKey.set(item.sampleKey, {
        label: item.label,
        justification: item.justification,
      });
    }
  }
  const sample = selected.map((item) => {
    const report = reportsByRepository.get(item.repo);
    if (!report) throw new Error(`Missing audit report for ${item.repo}`);
    const previousLabel = labelsBySampleKey.get(item.sampleKey);
    return {
      ...item,
      evidence: {
        targetSnippet: limitSourceEvidence(item.evidence.targetSnippet),
        addedCallerSnippet: limitSourceEvidence(
          item.evidence.addedCallerSnippet,
        ),
        directCallerSnippets: item.evidence.directCallerSnippets.map(
          ({ caller, snippet }) => ({
            caller,
            snippet: limitSourceEvidence(snippet),
          }),
        ),
        callSiteSnippets: callerCallSiteSnippets(report.repositoryRoot, item),
      },
      label: previousLabel?.label ?? "unsure",
      justification: previousLabel?.justification ?? "Not reviewed yet.",
    };
  });
  if (sample.some(({ label }) => !["TP", "FP", "unsure"].includes(label))) {
    throw new Error("Review labels must be TP, FP, or unsure.");
  }
  const allDeltas = reports.flatMap((report) =>
    report.fileBlastRadiusDeltaRows.map(({ delta }) => delta),
  );
  const riskLevelTransitions: Record<string, number> = {};
  for (const report of reports) {
    for (const row of report.fileBlastRadiusDeltaRows) {
      const key = `${row.v1RiskLevel}->${row.v2RiskLevel}`;
      riskLevelTransitions[key] = (riskLevelTransitions[key] ?? 0) + 1;
    }
  }
  const worstFileLevelBlastRadiusDrops = reports
    .flatMap((report) => report.worstFileLevelDropDetails ?? [])
    .sort((left, right) => left.delta - right.delta)
    .slice(0, 5);
  const labelSummary = labelCounts(sample);
  const reviewableCategoryEligibleCounts = categoryCounts(
    reviewableCandidates,
    "category",
  );
  const overallCounts = sample.reduce(
    (counts, { label }) => {
      if (label === "TP") counts.truePositives += 1;
      else if (label === "FP") counts.falsePositives += 1;
      else counts.unsure += 1;
      return counts;
    },
    { truePositives: 0, falsePositives: 0, unsure: 0 },
  );
  const judgedCount =
    overallCounts.truePositives + overallCounts.falsePositives;
  const overallConservativePrecision =
    sample.length === 0 ? null : overallCounts.truePositives / sample.length;
  const categoryFloors = Object.fromEntries(
    EXACT_CALLER_ADDITION_CATEGORIES.map((category) => {
      const result = labelSummary[category];
      const applies = result.sampleCount >= 10;
      return [
        category,
        {
          applies,
          reviewableEligibleCount: reviewableCategoryEligibleCounts[category],
          sampleCount: result.sampleCount,
          conservativePrecision: result.conservativePrecision,
          passes:
            !applies ||
            (result.conservativePrecision !== null &&
              result.conservativePrecision >= 0.8),
          fullySampledWhenUnderTenEligible:
            reviewableCategoryEligibleCounts[category] >= 10 ||
            result.sampleCount === reviewableCategoryEligibleCounts[category],
        },
      ];
    }),
  );
  const acceptanceGate = {
    overallThreshold: 0.9,
    categoryThreshold: 0.8,
    overallConservativePrecision,
    overallPass:
      overallConservativePrecision !== null &&
      overallConservativePrecision >= 0.9,
    categoryFloors,
    passes:
      overallConservativePrecision !== null &&
      overallConservativePrecision >= 0.9 &&
      Object.values(categoryFloors).every(({ passes }) => passes),
  };
  const artifact = {
    schemaVersion: 1,
    policies: {
      baseline: "scope-resolver-v1",
      candidate: "exact-enclosing-v2",
    },
    reproduction: {
      seed: options.seed,
      requestedSampleSize: options.sampleSize,
      inputRepositories: reports.map((report) => ({
        repository: report.repository,
        repositoryRoot: report.repositoryRoot,
        excludedPathPrefixes: report.excludedPathPrefixes ?? [],
        excludedPathSegments: report.excludedPathSegments ?? [],
      })),
      sampling:
        "SHA-256(seed, repo + target node key + added caller node key), balanced round-robin by category after explicit bundle exclusion",
      bundleExclusion:
        "Minified and vendored target/caller source paths remain counted in the audit population and are reported separately, but are not selected for precision labels.",
      precisionGateMetric:
        "Conservative precision = TP / (TP + FP + unsure); overall threshold 0.90; per-category threshold 0.80 only when at least 10 items are sampled.",
    },
    auditTotals: addTotals(reports),
    categoryEligibleCounts: categoryCounts(candidates, "category"),
    reviewableCategoryEligibleCounts,
    bundleExcludedFromPrecisionReview: {
      additionCount: bundleExcluded.length,
      categoryCounts: categoryCounts(bundleExcluded, "category"),
      sampledCount: 0,
    },
    fileLevelBlastRadiusDelta: distribution(allDeltas),
    riskLevelTransitions,
    worstFileLevelBlastRadiusDrops,
    sampleCounts: categoryCounts(sample, "category"),
    precision: {
      overall: {
        ...overallCounts,
        judgedPrecision:
          judgedCount === 0 ? null : overallCounts.truePositives / judgedCount,
        conservativePrecision: overallConservativePrecision,
      },
      byCategory: labelSummary,
    },
    acceptanceGate,
    sample,
  };
  mkdirSync(path.dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(
    `Review sample: ${sample.length}/${reviewableCandidates.length} reviewable v2-only impact additions; ${bundleExcluded.length} minified/vendor bundle additions excluded from labels and counted separately; seed ${options.seed}; file-level impact delta median ${artifact.fileLevelBlastRadiusDelta.median}, p90 ${artifact.fileLevelBlastRadiusDelta.p90}, max ${artifact.fileLevelBlastRadiusDelta.max}.\n`,
  );
}

main();
