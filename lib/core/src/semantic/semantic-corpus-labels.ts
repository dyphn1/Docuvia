import type {
  SemanticCorpusLabel,
  SemanticCorpusLabelResult,
  SemanticCorpusReason,
  SemanticCorpusSample,
} from "@workspace/contracts";

function conflicting(sample: SemanticCorpusSample): boolean {
  const { oracle, review } = sample;
  if (review.status === "conflict") return true;
  if (review.status !== "confirmed") return false;
  if (
    review.positiveTargetIds.some((id) => review.negativeTargetIds.includes(id))
  )
    return true;
  if (oracle.status !== "resolved" || oracle.targetIds.length === 0)
    return false;
  return (
    oracle.targetIds.length !== review.positiveTargetIds.length ||
    oracle.targetIds.some((id) => !review.positiveTargetIds.includes(id))
  );
}

function outsideScope(sample: SemanticCorpusSample): boolean {
  return (
    sample.source.language !== "typescript" ||
    sample.source.relation !== "cross-file-call" ||
    sample.review.status === "out-of-scope"
  );
}

function reasonFor(sample: SemanticCorpusSample): SemanticCorpusReason {
  const { source, oracle, review } = sample;
  if (
    source.snapshotHash !== oracle.snapshotHash ||
    source.snapshotHash !== review.snapshotHash
  )
    return "freshness-mismatch";
  if (conflicting(sample)) return "label-conflict";
  if (outsideScope(sample)) return "out-of-scope";
  if (oracle.status !== "resolved" || oracle.targetIds.length === 0)
    return "oracle-failure";
  if (review.status !== "confirmed") return "unreviewed";
  if (sample.truncated) return "input-truncated";
  return "ready";
}

function labelFor(
  targetId: string,
  reason: SemanticCorpusReason,
  sample: SemanticCorpusSample,
): SemanticCorpusLabel {
  if (reason === "out-of-scope") return "out-of-scope";
  if (reason !== "ready") return "unresolved";
  if (sample.review.positiveTargetIds.includes(targetId))
    return "confirmed-positive";
  if (sample.review.negativeTargetIds.includes(targetId))
    return "confirmed-negative";
  return "unresolved";
}

export function labelCorpusSample(
  sample: SemanticCorpusSample,
): SemanticCorpusLabelResult {
  const reason = reasonFor(sample);
  const targets = new Set(sample.candidates.map((c) => c.targetId));
  const goldTargetIds =
    reason === "ready" ? [...sample.review.positiveTargetIds] : [];
  return {
    sampleId: sample.sampleId,
    reason,
    labels: sample.candidates.map((c) => ({
      candidateId: c.id,
      targetId: c.targetId,
      label: labelFor(c.targetId, reason, sample),
    })),
    goldTargetIds,
    missingTargetIds: goldTargetIds.filter((id) => !targets.has(id)),
  };
}
