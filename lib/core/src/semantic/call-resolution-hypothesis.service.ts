import type {
  AstCallSiteShapeFact,
  CallResolutionHypothesisRequest,
  CallResolutionHypothesisResult,
  CallResolutionHypothesisServiceOptions,
  CallResolutionHypothesisWorkspaceIndex,
  CallResolutionHypothesisWorkspaceInput,
  ICallResolutionHypothesisService,
} from "@workspace/contracts";
import {
  CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
  DocuviaError,
  ErrorCodes,
} from "@workspace/contracts";
import {
  matchingCalibrationRecords,
  selectValidCalibrationRecord,
} from "./call-resolution-hypothesis-calibration.js";
import {
  CandidateWithoutRank,
  NormalizedServiceOptions,
  createConfigurationHash,
  normalizeServiceOptions,
  validateHypothesisRequest,
} from "./call-resolution-hypothesis-internal.js";
import {
  IndexedWorkspace,
  createIndexedWorkspace,
  createRuleSignature,
  getReceiverTypeFact,
  hashFeatureInput,
} from "./call-resolution-hypothesis-index.js";
import {
  boundProposals,
  decideResolution,
  filterCandidates,
  rankCandidates,
} from "./call-resolution-hypothesis-ranking.js";
import { proveUniqueThisMember } from "./call-resolution-strict-proof.js";

function sameCalleeBinding(
  left: AstCallSiteShapeFact["calleeBinding"],
  right: AstCallSiteShapeFact["calleeBinding"],
): boolean {
  if (!left || !right) return left === right;
  if (left.kind !== right.kind || left.name !== right.name) return false;
  if (left.kind === "unbound" || right.kind === "unbound")
    return left.kind === right.kind;
  return (
    left.declarationSpan.start === right.declarationSpan.start &&
    left.declarationSpan.end === right.declarationSpan.end &&
    left.scopeSpan.start === right.scopeSpan.start &&
    left.scopeSpan.end === right.scopeSpan.end
  );
}

export class CallResolutionHypothesisService implements ICallResolutionHypothesisService {
  private readonly options: NormalizedServiceOptions;
  private readonly configurationHash: string;
  private readonly indexes = new WeakMap<object, IndexedWorkspace>();

  constructor(options: CallResolutionHypothesisServiceOptions = {}) {
    this.options = normalizeServiceOptions(options);
    this.configurationHash = createConfigurationHash(this.options);
  }

  indexWorkspace(
    input: CallResolutionHypothesisWorkspaceInput,
  ): CallResolutionHypothesisWorkspaceIndex {
    const workspace = createIndexedWorkspace(input, this.configurationHash);
    this.indexes.set(workspace.handle, workspace);
    return workspace.handle;
  }

  hypothesize(
    request: CallResolutionHypothesisRequest,
  ): CallResolutionHypothesisResult {
    validateHypothesisRequest(request);
    const workspace = this.getWorkspace(request.workspaceIndex);
    const baseIndexedCandidates =
      workspace.candidatesByMember.get(request.callSite.calleeName) ?? [];
    const indexedCandidates = this.candidatesForRequest(
      request,
      workspace,
      baseIndexedCandidates,
    );
    const receiverFact = getReceiverTypeFact(workspace, request);
    const receiverTypeName = receiverFact?.typeName ?? null;
    const generated = rankCandidates(
      indexedCandidates,
      request,
      workspace,
      receiverTypeName,
    );
    const ruleSignature = createRuleSignature(
      request,
      workspace,
      indexedCandidates,
      receiverFact,
      this.configurationHash,
    );
    const featureInputHash = hashFeatureInput(
      request,
      workspace,
      generated,
      receiverFact,
    );
    const filtered = filterCandidates(
      generated,
      request,
      workspace,
      receiverTypeName,
    );
    const { proposals, truncated } = boundProposals(
      filtered.candidates,
      this.options,
    );
    const strictProof = proveUniqueThisMember(
      request,
      generated,
      workspace,
      truncated,
    );
    const matchingRecords = matchingCalibrationRecords(
      this.options.calibrationRecords,
      ruleSignature,
    );
    const calibration = selectValidCalibrationRecord(
      matchingRecords,
      this.options,
      ruleSignature,
      this.configurationHash,
    );
    const decision = decideResolution(
      proposals,
      truncated,
      filtered.unsupportedCallShape,
      matchingRecords.length > 0,
      calibration,
    );
    this.verifyDecisionConfidence(decision.confidence);

    return {
      schemaVersion: CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION,
      candidateGeneratorVersion: workspace.handle.candidateGeneratorVersion,
      configurationHash: this.configurationHash,
      sourceFingerprint: workspace.handle.sourceFingerprint,
      featureInputHash,
      ruleSignature,
      candidateSetComplete: workspace.complete,
      truncated,
      generatedCandidateKeys: indexedCandidates.map(
        ({ targetKey }) => targetKey,
      ),
      candidates: proposals,
      filterStages: filtered.stages,
      status: decision.status,
      selected: decision.selected,
      confidence: decision.confidence,
      reason: decision.reason,
      strictProof,
    };
  }

  private getWorkspace(
    handle: CallResolutionHypothesisWorkspaceIndex,
  ): IndexedWorkspace {
    const workspace = this.indexes.get(handle);
    if (!workspace)
      throw new DocuviaError(
        ErrorCodes.SEMANTIC_INVALID_REQUEST,
        "workspaceIndex must come from this service instance.",
      );
    return workspace;
  }

  private candidatesForRequest(
    request: CallResolutionHypothesisRequest,
    workspace: IndexedWorkspace,
    baseCandidates: readonly CandidateWithoutRank[],
  ): readonly CandidateWithoutRank[] {
    if (!this.canEnrichImportAlias(request, workspace)) return baseCandidates;
    const aliases =
      workspace.directImportAliasCandidatesByCallerFile
        .get(request.callerFilePath)
        ?.get(request.callSite.calleeName) ?? [];
    return mergeCandidatesByTargetKey(baseCandidates, aliases);
  }

  private canEnrichImportAlias(
    request: CallResolutionHypothesisRequest,
    workspace: IndexedWorkspace,
  ): boolean {
    return (
      request.callSite.calleeBinding?.kind !== "type-only-import" &&
      request.callSite.calleeKind === "bare" &&
      request.callSite.calleeBinding?.kind === "import" &&
      !!request.callerSourceContentHash &&
      workspace.sourceContentHashByFile.get(request.callerFilePath) ===
        request.callerSourceContentHash &&
      this.isCallSiteBoundToCaller(
        request.callSite,
        workspace,
        request.callerFilePath,
      )
    );
  }

  private isCallSiteBoundToCaller(
    callSite: AstCallSiteShapeFact,
    workspace: IndexedWorkspace,
    callerFilePath: string,
  ): boolean {
    const matches = (
      workspace.callSiteShapesByFile.get(callerFilePath) ?? []
    ).filter(
      (shape) =>
        shape.startLine === callSite.startLine &&
        shape.startColumn === callSite.startColumn &&
        shape.calleeName === callSite.calleeName &&
        shape.calleeKind === callSite.calleeKind &&
        shape.receiverText === callSite.receiverText &&
        sameCalleeBinding(shape.calleeBinding, callSite.calleeBinding),
    );
    return matches.length === 1;
  }

  private verifyDecisionConfidence(confidence: number | null): void {
    if (
      confidence !== null &&
      (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    )
      throw new DocuviaError(
        ErrorCodes.SEMANTIC_INVALID_REQUEST,
        "calibrated confidence must be finite and in [0, 1].",
      );
  }
}

function mergeCandidatesByTargetKey(
  baseCandidates: readonly CandidateWithoutRank[],
  aliases: readonly CandidateWithoutRank[],
): readonly CandidateWithoutRank[] {
  if (aliases.length === 0) return baseCandidates;
  const combined = new Map(
    baseCandidates.map((candidate) => [candidate.targetKey, candidate]),
  );
  for (const candidate of aliases) combined.set(candidate.targetKey, candidate);
  return [...combined.values()];
}
