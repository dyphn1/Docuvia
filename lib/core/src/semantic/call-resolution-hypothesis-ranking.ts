import type {
  CallResolutionHypothesisCandidate,
  CallResolutionHypothesisFilterStage,
  CallResolutionHypothesisRequest,
  CallResolutionHypothesisResult,
} from "@workspace/contracts";
import {
  CandidateWithoutRank,
  NormalizedServiceOptions,
  RANKING_WEIGHTS,
  isFiniteRatio,
} from "./call-resolution-hypothesis-internal.js";
import {
  IndexedWorkspace,
  candidateMatchesReceiver,
} from "./call-resolution-hypothesis-index.js";
import type { CallResolutionCalibrationRecord } from "@workspace/contracts";

export interface FilteredHypotheses {
  readonly candidates: readonly CallResolutionHypothesisCandidate[];
  readonly stages: CallResolutionHypothesisResult["filterStages"];
  readonly unsupportedCallShape: boolean;
}

export interface ResolutionDecision {
  readonly status: CallResolutionHypothesisResult["status"];
  readonly selected: CallResolutionHypothesisCandidate | null;
  readonly confidence: number | null;
  readonly reason: CallResolutionHypothesisResult["reason"];
}

function compatibleArity(
  declaration: CandidateWithoutRank["declarations"][number],
  count: number,
): boolean | undefined {
  if (!declaration.arity || declaration.unsupportedReason) return undefined;
  return (
    count >= declaration.arity.requiredParameterCount &&
    (declaration.arity.maxParameterCount === null ||
      count <= declaration.arity.maxParameterCount)
  );
}

function candidateSort(
  left: CallResolutionHypothesisCandidate,
  right: CallResolutionHypothesisCandidate,
): number {
  return (
    right.rankScore - left.rankScore ||
    left.filePath.localeCompare(right.filePath) ||
    left.owner.span.start - right.owner.span.start ||
    Number(left.isStatic) - Number(right.isStatic) ||
    left.targetKey.localeCompare(right.targetKey)
  );
}

function rankCandidate(
  candidate: CandidateWithoutRank,
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  receiverTypeName: string | null,
): CallResolutionHypothesisCandidate {
  let rankScore = 0;
  const rankingSignals: string[] = [];
  if (
    receiverTypeName &&
    candidateMatchesReceiver(
      candidate,
      workspace.factsByFile.get(candidate.filePath) ?? [],
      receiverTypeName,
    )
  ) {
    rankScore += RANKING_WEIGHTS.explicitReceiverType;
    rankingSignals.push("explicit-receiver-type");
  }
  if (hasPeerSupport(candidate, request, workspace)) {
    rankScore += RANKING_WEIGHTS.peerMembers;
    rankingSignals.push("same-binding-peer-members");
  }
  if (hasCompatibleArity(candidate, request.callSite.argumentCount)) {
    rankScore += RANKING_WEIGHTS.compatibleArity;
    rankingSignals.push("compatible-argument-count");
  }
  if (sharesDirectory(candidate.filePath, request.callerFilePath)) {
    rankScore += RANKING_WEIGHTS.sameDirectory;
    rankingSignals.push("same-directory");
  }
  return { ...candidate, rankScore, rankingSignals };
}

function hasPeerSupport(
  candidate: CandidateWithoutRank,
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
): boolean {
  const peers = request.callSite.peerMemberNames;
  if (peers.length === 0) return false;
  const names = workspace.memberNamesByTargetKey.get(candidate.targetKey);
  return Boolean(names && peers.every((name) => names.has(name)));
}

function hasCompatibleArity(
  candidate: CandidateWithoutRank,
  argumentCount: number | null,
): boolean {
  if (argumentCount === null) return false;
  const arities = candidate.declarations
    .map((declaration) => compatibleArity(declaration, argumentCount))
    .filter((value): value is boolean => value !== undefined);
  return arities.length > 0 && arities.some(Boolean);
}

function sharesDirectory(candidatePath: string, callerPath: string): boolean {
  const directory = (filePath: string) =>
    filePath.split("/").slice(0, -1).join("/");
  return directory(candidatePath) === directory(callerPath);
}

export function rankCandidates(
  candidates: readonly CandidateWithoutRank[],
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  receiverTypeName: string | null,
): CallResolutionHypothesisCandidate[] {
  return candidates
    .map((candidate) =>
      rankCandidate(candidate, request, workspace, receiverTypeName),
    )
    .sort(candidateSort);
}

function stage(
  inputCount: number,
  outputCount: number,
  applied: boolean,
): CallResolutionHypothesisFilterStage {
  return { inputCount, outputCount, applied };
}

function visibilityFilter(
  candidates: readonly CallResolutionHypothesisCandidate[],
  request: CallResolutionHypothesisRequest,
): CallResolutionHypothesisCandidate[] {
  return candidates.filter((candidate) => {
    const isPrivate = candidate.declarations.some(
      (declaration) => declaration.visibility === "private",
    );
    if (!isPrivate) return true;
    const callerType = request.callSite.callerType;
    return Boolean(
      callerType &&
      request.callerFilePath === candidate.filePath &&
      callerType.name === candidate.owner.name &&
      callerType.span.start === candidate.owner.span.start &&
      callerType.span.end === candidate.owner.span.end,
    );
  });
}

function explicitTypeFilter(
  candidates: readonly CallResolutionHypothesisCandidate[],
  workspace: IndexedWorkspace,
  receiverTypeName: string | null,
): CallResolutionHypothesisCandidate[] {
  if (!receiverTypeName) return [];
  return candidates.filter((candidate) =>
    candidateMatchesReceiver(
      candidate,
      workspace.factsByFile.get(candidate.filePath) ?? [],
      receiverTypeName,
    ),
  );
}

function peerFilter(
  candidates: readonly CallResolutionHypothesisCandidate[],
  peerNames: readonly string[],
  workspace: IndexedWorkspace,
): CallResolutionHypothesisCandidate[] {
  if (peerNames.length === 0) return [];
  return candidates.filter((candidate) => {
    if (!candidate.inventoryComplete) return true;
    const names = workspace.memberNamesByTargetKey.get(candidate.targetKey);
    return Boolean(names && peerNames.every((name) => names.has(name)));
  });
}

function arityFilter(
  candidates: readonly CallResolutionHypothesisCandidate[],
  request: CallResolutionHypothesisRequest,
): CallResolutionHypothesisCandidate[] {
  const count = request.callSite.argumentCount;
  if (count === null || request.callSite.hasSpreadArgument) return [];
  return candidates.filter((candidate) => {
    if (candidate.sourceLanguage === "javascript") return true;
    if (!candidate.inventoryComplete) return true;
    const compatible = candidate.declarations
      .map((declaration) => compatibleArity(declaration, count))
      .filter((value): value is boolean => value !== undefined);
    return compatible.length === 0 || compatible.some(Boolean);
  });
}

function applyEvidenceStage<T>(
  current: readonly T[],
  filtered: readonly T[],
): { current: readonly T[]; stage: CallResolutionHypothesisFilterStage } {
  const applied = filtered.length > 0 && filtered.length < current.length;
  return {
    current: applied ? filtered : current,
    stage: stage(
      current.length,
      applied ? filtered.length : current.length,
      applied,
    ),
  };
}

export function filterCandidates(
  generated: readonly CallResolutionHypothesisCandidate[],
  request: CallResolutionHypothesisRequest,
  workspace: IndexedWorkspace,
  receiverTypeName: string | null,
): FilteredHypotheses {
  let current = generated;
  const visible = visibilityFilter(current, request);
  const visibilityApplied = visible.length < current.length;
  const visibility = {
    current: visible,
    stage: stage(current.length, visible.length, visibilityApplied),
  };
  current = visibility.current;

  const explicit = applyEvidenceStage(
    current,
    explicitTypeFilter(current, workspace, receiverTypeName),
  );
  current = explicit.current;

  const peers = applyEvidenceStage(
    current,
    peerFilter(current, request.callSite.peerMemberNames, workspace),
  );
  current = peers.current;

  const arity = applyEvidenceStage(current, arityFilter(current, request));
  current = arity.current;

  return {
    candidates: current,
    stages: {
      visibility: visibility.stage,
      explicitReceiverType: explicit.stage,
      peerMembers: peers.stage,
      argumentShape: arity.stage,
    },
    unsupportedCallShape:
      !workspace.factsByFile.has(request.callerFilePath) ||
      request.callSite.calleeKind === "arg-chain" ||
      ((request.callSite.calleeKind === "member" ||
        request.callSite.calleeKind === "this") &&
        request.callSite.receiverBinding === null),
  };
}

function decideCalibratedResult(
  proposals: readonly CallResolutionHypothesisCandidate[],
  record: CallResolutionCalibrationRecord,
): ResolutionDecision {
  const top = proposals[0];
  const tied = proposals[1]?.rankScore === top?.rankScore;
  if (!top || tied || top.rankScore < record.thresholdScore)
    return ambiguous("calibration-rejected");
  if (!isFiniteRatio(record.confidenceLowerBound))
    return ambiguous("calibration-rejected");
  return {
    status: "likely",
    selected: top,
    confidence: record.confidenceLowerBound,
    reason: "calibrated-likely",
  };
}

function ambiguous(
  reason: CallResolutionHypothesisResult["reason"],
): ResolutionDecision {
  return { status: "ambiguous", selected: null, confidence: null, reason };
}

export function decideResolution(
  proposals: readonly CallResolutionHypothesisCandidate[],
  truncated: boolean,
  unsupportedCallShape: boolean,
  hasMatchingCalibrationRecord: boolean,
  record: CallResolutionCalibrationRecord | undefined,
): ResolutionDecision {
  if (proposals.length === 0) return ambiguous("no-supported-candidates");
  if (unsupportedCallShape) return ambiguous("unsupported-call-shape");
  if (truncated) return ambiguous("candidate-list-truncated");
  if (!record)
    return ambiguous(
      hasMatchingCalibrationRecord
        ? "calibration-rejected"
        : "uncalibrated-signature",
    );
  return decideCalibratedResult(proposals, record);
}

export function boundProposals(
  candidates: readonly CallResolutionHypothesisCandidate[],
  options: NormalizedServiceOptions,
): {
  proposals: readonly CallResolutionHypothesisCandidate[];
  truncated: boolean;
} {
  return {
    proposals: candidates.slice(0, options.maxCandidates),
    truncated: candidates.length > options.maxCandidates,
  };
}
