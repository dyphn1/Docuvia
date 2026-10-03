import type {
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
    const indexedCandidates =
      workspace.candidatesByMember.get(request.callSite.calleeName) ?? [];
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
      workspace.complete,
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
