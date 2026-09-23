import type {
  SemanticCorpusLabelResult,
  SemanticCorpusMetrics,
  SemanticCorpusSample,
  SemanticCorpusSplit,
} from "@workspace/contracts";

export const CORPUS_SPLITS: readonly SemanticCorpusSplit[] = [
  "train",
  "calibration",
  "test",
  "temporal",
];
export const CORPUS_ORIGINS = ["real", "synthetic"] as const;

export function corpusMetrics(
  samples: readonly SemanticCorpusSample[],
  results: ReadonlyMap<string, SemanticCorpusLabelResult>,
): SemanticCorpusMetrics {
  let trustedGoldRequests = 0;
  let goldTargets = 0;
  let coveredTargets = 0;
  let fullyCoveredRequests = 0;
  for (const sample of samples) {
    const reason = results.get(sample.sampleId)!.reason;
    if (reason !== "ready" && reason !== "input-truncated") continue;
    const gold = sample.review.positiveTargetIds;
    const candidates = new Set(sample.candidates.map((c) => c.targetId));
    const covered = gold.filter((id) => candidates.has(id)).length;
    trustedGoldRequests++;
    goldTargets += gold.length;
    coveredTargets += covered;
    if (covered === gold.length) fullyCoveredRequests++;
  }
  return {
    requests: samples.length,
    trustedGoldRequests,
    goldTargets,
    coveredTargets,
    fullyCoveredRequests,
    candidateRecall: goldTargets === 0 ? null : coveredTargets / goldTargets,
    setCoverage:
      trustedGoldRequests === 0
        ? null
        : fullyCoveredRequests / trustedGoldRequests,
  };
}

export function readyRealCounts(
  samples: readonly SemanticCorpusSample[],
  results: ReadonlyMap<string, SemanticCorpusLabelResult>,
  field: "duplicateGroup" | "repoFamily",
): Record<SemanticCorpusSplit, number> {
  const counts: Record<SemanticCorpusSplit, number> = {
    train: 0,
    calibration: 0,
    test: 0,
    temporal: 0,
  };
  for (const split of CORPUS_SPLITS) {
    const eligible = samples.filter(
      (s) =>
        s.source.origin === "real" &&
        s.source.split === split &&
        results.get(s.sampleId)!.reason === "ready",
    );
    counts[split] = new Set(eligible.map((s) => s.source[field])).size;
  }
  return counts;
}

export function sufficientCorpusSize(
  requests: Record<SemanticCorpusSplit, number>,
  families: Record<SemanticCorpusSplit, number>,
): boolean {
  return (
    families.train >= 4 &&
    families.calibration >= 2 &&
    families.test >= 2 &&
    requests.train + requests.calibration + requests.test >= 10_000 &&
    requests.test >= 2_000 &&
    requests.temporal >= 1
  );
}
