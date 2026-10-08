import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  buildEvidenceFingerprint,
  buildExactCallerSampleKey,
  buildRepositoryIdentity,
  distribution,
  estimatePopulationWeightedPrecision,
  evaluateAcceptanceGate,
  EXACT_CALLER_ADDITION_CATEGORIES,
  extractCallSiteEvidence,
  findMatchingReviewLabel,
  indexAuditsByIdentity,
  limitSourceEvidence,
  labelCounts,
  recomputeAndVerifySourceManifest,
  selectSeededStratifiedSample,
  partitionBundleReviewCandidates,
  type ExactCallerAdditionCategory,
  type LabeledSampleCandidate,
  type SampleCandidate,
  type ReviewEvidence,
  type ReviewLabelProvenance,
  type SourceManifest,
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
    readonly callSiteSnippets?: readonly string[];
  };
};

type AuditReport = {
  readonly repository: string;
  readonly repositoryRoot: string;
  readonly repositoryIdentity?: string;
  readonly repositoryHeadSha?: string;
  readonly repositoryRemoteUrl?: string | null;
  readonly manifestSha256?: string;
  readonly manifestFileCount?: number;
  readonly manifestDefinition?: SourceManifest["definition"];
  readonly sourceTreeDirty?: boolean;
  readonly policies?: { readonly candidate?: string };
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
    readonly v1FileLevelRiskProxy: string;
    readonly v2FileLevelRiskProxy: string;
    readonly v1ConfirmedImpactEntryCount: number;
    readonly v2ConfirmedImpactEntryCount: number;
    readonly v1ProductionRiskLevel: string;
    readonly v2ProductionRiskLevel: string;
    readonly v1GraphNodeCount: number;
    readonly v2GraphNodeCount: number;
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

type PreparedAuditReport = AuditReport & {
  readonly repositoryIdentity: string;
  readonly repositoryHeadSha: string;
  readonly repositoryRemoteUrl: string | null;
  readonly callerPolicy: string;
  readonly manifestSha256: string;
  readonly manifestFileCount: number;
  readonly manifestDefinition: SourceManifest["definition"];
  readonly sourceTreeDirty: boolean;
};

type ReviewLabelArtifact = {
  readonly sample?: readonly ReviewLabelProvenance[];
  readonly labelReaffirmation?: string;
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

function readGitValue(repositoryRoot: string, args: readonly string[]): string {
  try {
    return execFileSync("git", ["-C", repositoryRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? error.status
        : undefined;
    if (args[0] === "config" && status === 1) return "";
    throw new Error(
      `Unable to read git ${args.join(" ")} for ${repositoryRoot}`,
      { cause: error },
    );
  }
}

function prepareAuditReport(report: AuditReport): PreparedAuditReport {
  const repositoryRoot = path.resolve(report.repositoryRoot);
  const currentHead = readGitValue(repositoryRoot, ["rev-parse", "HEAD"]);
  if (report.repositoryHeadSha && report.repositoryHeadSha !== currentHead) {
    throw new Error(
      `Audit revision mismatch for ${report.repository}: recorded ${report.repositoryHeadSha}, current ${currentHead}`,
    );
  }
  if (
    !report.manifestSha256 ||
    report.manifestFileCount === undefined ||
    !report.manifestDefinition ||
    report.sourceTreeDirty === undefined
  ) {
    throw new Error(
      `Audit report for ${report.repository} lacks a source manifest; re-run the audit`,
    );
  }
  const sourceDiscoveryOptions = {
    excludedPathPrefixes: report.excludedPathPrefixes ?? [],
    excludedPathSegments: report.excludedPathSegments ?? [],
  };
  const liveManifest = recomputeAndVerifySourceManifest(
    repositoryRoot,
    report.repository,
    {
      manifestSha256: report.manifestSha256,
      manifestFileCount: report.manifestFileCount,
      definition: report.manifestDefinition,
    },
    sourceDiscoveryOptions,
  );
  const remoteUrl =
    report.repositoryRemoteUrl ??
    (readGitValue(repositoryRoot, ["config", "--get", "remote.origin.url"]) ||
      null);
  const repositoryIdentity = buildRepositoryIdentity(
    remoteUrl,
    repositoryRoot,
    currentHead,
    liveManifest.manifestSha256,
  );
  if (
    report.repositoryIdentity &&
    report.repositoryIdentity !== repositoryIdentity
  ) {
    throw new Error(
      `Audit identity mismatch for ${report.repository}: recorded ${report.repositoryIdentity}, current ${repositoryIdentity}`,
    );
  }
  return {
    ...report,
    repositoryRoot,
    repositoryHeadSha: currentHead,
    repositoryRemoteUrl: remoteUrl,
    repositoryIdentity,
    callerPolicy: report.policies?.candidate ?? "exact-enclosing-v2",
    manifestSha256: liveManifest.manifestSha256,
    manifestFileCount: liveManifest.manifestFileCount,
    manifestDefinition: liveManifest.definition,
    sourceTreeDirty: report.sourceTreeDirty,
  };
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

function incrementTransition(
  transitions: Record<string, number>,
  from: string,
  to: string,
): void {
  const key = `${from}->${to}`;
  transitions[key] = (transitions[key] ?? 0) + 1;
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
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
  const reports = options.inputs.map(readAuditReport).map(prepareAuditReport);
  const reportsByRepository = indexAuditsByIdentity(reports);
  const candidates = reports.flatMap((report) =>
    report.v2OnlyImpactAdditions.map((item) => ({
      ...item,
      repo: report.repository,
      sampleKey: buildExactCallerSampleKey(
        report.repositoryIdentity,
        item.target.nodeKey,
        item.addedCaller.nodeKey,
      ),
      samplingKey: item.samplingKey ?? item.sampleKey,
      repositoryIdentity: report.repositoryIdentity,
      repositoryHeadSha: report.repositoryHeadSha,
      manifestSha256: report.manifestSha256,
      manifestFileCount: report.manifestFileCount,
      sourceTreeDirty: report.sourceTreeDirty,
      callerPolicy: report.callerPolicy,
    })),
  );
  const { reviewable: reviewableCandidates, bundleExcluded } =
    partitionBundleReviewCandidates(candidates);
  const selected = selectSeededStratifiedSample(
    reviewableCandidates,
    options.sampleSize,
    options.seed,
  );
  const previousLabelArtifact = options.labelsPath
    ? (JSON.parse(
        readFileSync(options.labelsPath, "utf8"),
      ) as ReviewLabelArtifact)
    : undefined;
  const previousItems = previousLabelArtifact?.sample ?? [];
  const sample = selected.map((item) => {
    const report = reportsByRepository.get(item.repositoryIdentity);
    if (!report) throw new Error(`Missing audit report for ${item.repo}`);
    const evidence = {
      targetSnippet: limitSourceEvidence(item.evidence.targetSnippet),
      addedCallerSnippet: limitSourceEvidence(item.evidence.addedCallerSnippet),
      directCallerSnippets: item.evidence.directCallerSnippets.map(
        ({ caller, snippet }) => ({
          caller,
          snippet: limitSourceEvidence(snippet),
        }),
      ),
      callSiteSnippets: callerCallSiteSnippets(report.repositoryRoot, item),
    };
    const fingerprintEvidence: ReviewEvidence = {
      targetSnippet: evidence.targetSnippet,
      addedCallerSnippet: evidence.addedCallerSnippet,
      callSiteSnippets: evidence.callSiteSnippets,
    };
    const evidenceFingerprint = buildEvidenceFingerprint(
      item.repositoryHeadSha,
      item.manifestSha256,
      item.callerPolicy,
      fingerprintEvidence,
    );
    const previousLabel = options.labelsPath
      ? findMatchingReviewLabel(
          previousItems,
          item.sampleKey,
          evidenceFingerprint,
        )
      : undefined;
    const { samplingKey, ...reviewItem } = item;
    return {
      ...reviewItem,
      selectionKey: samplingKey,
      evidence,
      evidenceFingerprint,
      label: previousLabel?.label ?? "unsure",
      reviewed: previousLabel !== undefined,
      justification: previousLabel?.justification ?? "Not reviewed yet.",
    };
  });
  if (sample.some(({ label }) => !["TP", "FP", "unsure"].includes(label))) {
    throw new Error("Review labels must be TP, FP, or unsure.");
  }
  const allDeltas = reports.flatMap((report) =>
    report.fileBlastRadiusDeltaRows.map(({ delta }) => delta),
  );
  const fileLevelRiskProxyTransitions: Record<string, number> = {};
  const productionRiskTransitions: Record<string, number> = {};
  for (const report of reports) {
    for (const row of report.fileBlastRadiusDeltaRows) {
      incrementTransition(
        fileLevelRiskProxyTransitions,
        row.v1FileLevelRiskProxy,
        row.v2FileLevelRiskProxy,
      );
      incrementTransition(
        productionRiskTransitions,
        row.v1ProductionRiskLevel,
        row.v2ProductionRiskLevel,
      );
    }
  }
  const worstFileLevelBlastRadiusDrops = reports
    .flatMap((report) => report.worstFileLevelDropDetails ?? [])
    .sort((left, right) => left.delta - right.delta)
    .slice(0, 5);
  const reviewedSample = sample.filter(({ reviewed }) => reviewed);
  const labelSummary = labelCounts(sample);
  const reviewableCategoryEligibleCounts = categoryCounts(
    reviewableCandidates,
    "category",
  );
  const overallCounts = reviewedSample.reduce(
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
  const stratifiedStressScore =
    reviewedSample.length === 0
      ? null
      : overallCounts.truePositives / reviewedSample.length;
  const populationWeightedPrecision = estimatePopulationWeightedPrecision(
    reviewableCategoryEligibleCounts,
    reviewedSample as LabeledSampleCandidate[],
  );
  const acceptanceGate = evaluateAcceptanceGate(
    reviewableCategoryEligibleCounts,
    reviewedSample as LabeledSampleCandidate[],
    populationWeightedPrecision,
  );
  const productionRiskNumeratorDelta = distribution(
    reports.flatMap((report) =>
      report.fileBlastRadiusDeltaRows.map(
        (row) =>
          row.v2ConfirmedImpactEntryCount - row.v1ConfirmedImpactEntryCount,
      ),
    ),
  );
  const artifact = {
    schemaVersion: 4,
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
        repositoryIdentity: report.repositoryIdentity,
        repositoryHeadSha: report.repositoryHeadSha,
        repositoryRemoteUrl: report.repositoryRemoteUrl,
        manifestSha256: report.manifestSha256,
        manifestFileCount: report.manifestFileCount,
        manifestDefinition: report.manifestDefinition,
        sourceTreeDirty: report.sourceTreeDirty,
        excludedPathPrefixes: report.excludedPathPrefixes ?? [],
        excludedPathSegments: report.excludedPathSegments ?? [],
      })),
      sampling:
        "SHA-256(seed, legacy selection key retained for migration), balanced round-robin by category after explicit bundle exclusion; audit sample keys use repository identity + target and caller node keys",
      labelProvenance:
        "A carried label requires exact sampleKey and SHA-256 evidenceFingerprint match over audit repository HEAD, source manifest SHA-256, candidate caller policy, target snippet, added-caller snippet, and call-site snippets. Live source manifests are recomputed using the audit discovery rules before sampling; a mismatch rejects the audit. Legacy migration additionally requires exact source evidence equality.",
      bundleExclusion:
        "Minified and vendored target/caller source paths remain counted in the audit population and are reported separately, but are not selected for precision labels.",
      stratifiedStressScore:
        "Diagnostic only: TP / all reviewed sample items, with unsure in the denominator. The balanced-stratum score is not a population precision estimate.",
      populationWeightedPrecision:
        "Each reviewable category's TP rate (unsure counts as not-TP) is weighted by its eligible population count. The nominal 95% interval sums weighted per-stratum 99% Wilson bounds; Bonferroni correction spans the five categories, exhaustive strata use exact bounds, and sampled strata do not use a finite-population correction.",
      precisionGate:
        "Pass requires adequate reviewed-sample coverage, a population-weighted nominal 95% lower bound >= 0.90, and conservative per-category TP rates >= 0.80 for categories with at least 10 eligible items. Categories with fewer than 10 eligible items must be exhaustively labeled. The stratified stress score is diagnostic and does not drive the gate.",
      labelCarryover: options.labelsPath
        ? previousLabelArtifact?.labelReaffirmation
          ? "Pre-manifest labels were not carried automatically. The source judgments were reaffirmed against matching repository HEADs and unchanged target/caller/call-site evidence, then strict manifest-bound keys and fingerprints were verified."
          : `Strict manifest-bound key-and-fingerprint carryover from ${path.relative(process.cwd(), options.labelsPath)}.`
        : "No prior labels were imported.",
      labelReaffirmation: previousLabelArtifact?.labelReaffirmation ?? null,
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
    fileLevelRiskProxyTransitions,
    productionRiskTransitions,
    productionRiskNumeratorDelta,
    worstFileLevelBlastRadiusDrops,
    sampleCounts: categoryCounts(sample, "category"),
    reviewedSampleCounts: categoryCounts(reviewedSample, "category"),
    sampleScores: {
      stratifiedStress: {
        ...overallCounts,
        reviewedSampleCount: reviewedSample.length,
        selectedSampleCount: sample.length,
        judgedPrecision:
          judgedCount === 0 ? null : overallCounts.truePositives / judgedCount,
        stratifiedStressScore,
      },
    },
    categoryPrecision: labelSummary,
    populationWeightedPrecision,
    acceptanceGate,
    sample,
  };
  mkdirSync(path.dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(
    `Review sample: ${reviewedSample.length} reviewed/${sample.length} selected of ${reviewableCandidates.length} reviewable v2-only impact additions; ${bundleExcluded.length} minified/vendor bundle additions excluded from labels and counted separately; stratified stress score ${formatPercent(stratifiedStressScore)}; population-weighted precision ${formatPercent(populationWeightedPrecision.estimate)} (nominal 95% interval ${formatPercent(populationWeightedPrecision.interval.lower)} to ${formatPercent(populationWeightedPrecision.interval.upper)}); gate ${acceptanceGate.status}; seed ${options.seed}; file-level impact delta median ${artifact.fileLevelBlastRadiusDelta.median}, p90 ${artifact.fileLevelBlastRadiusDelta.p90}, max ${artifact.fileLevelBlastRadiusDelta.max}.\n`,
  );
}

main();
