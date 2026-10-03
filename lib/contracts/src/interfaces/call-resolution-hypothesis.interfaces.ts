import type {
  AstCallSiteShapeFact,
  AstCallSiteShapeFacts,
} from "./call-site-shape-facts.interfaces.js";
import type {
  AstDeclaredTypeFacts,
  AstDeclaredTypeOwner,
  AstDeclaredTypeLanguage,
  AstDeclaredDeclaration,
  AstUtf16Span,
} from "./declared-type-facts.interfaces.js";

export const CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION =
  "declared-member-hypothesis-v3" as const;
export const CALL_RESOLUTION_RANKING_POLICY_VERSION =
  "ordered-evidence-v1" as const;
export const CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION = 1 as const;

export interface CallResolutionHypothesisSourceFile {
  readonly filePath: string;
  /** SHA-256 of the exact source bytes used to produce this file's syntax facts. */
  readonly sourceContentHash?: string;
  /** Parser output from the same source bytes; strict proofs verify callSite membership here. */
  readonly callSiteShapeFacts?: AstCallSiteShapeFacts | null;
  /** Missing facts make the workspace candidate inventory incomplete. */
  readonly declaredTypeFacts: AstDeclaredTypeFacts | null;
}

export interface CallResolutionHypothesisWorkspaceInput {
  readonly sourceFingerprint: string;
  /** True only when the caller supplied every source file in the workspace index. */
  readonly sourceIndexComplete: boolean;
  readonly sourceFiles: readonly CallResolutionHypothesisSourceFile[];
}

/** Opaque, immutable handle returned by one service's indexWorkspace call. */
export interface CallResolutionHypothesisWorkspaceIndex {
  readonly schemaVersion: typeof CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION;
  readonly sourceFingerprint: string;
  readonly candidateGeneratorVersion: typeof CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION;
  readonly configurationHash: string;
}

export interface CallResolutionHypothesisRequest {
  readonly callerFilePath: string;
  /** Must be the hash paired with the parser-produced callSite fact. */
  readonly callerSourceContentHash?: string;
  readonly callSite: AstCallSiteShapeFact;
  readonly workspaceIndex: CallResolutionHypothesisWorkspaceIndex;
}

export interface CallResolutionHypothesisCandidate {
  /** Stable source-only identity; it is not a persisted graph node ID. */
  readonly targetKey: string;
  readonly filePath: string;
  readonly owner: AstDeclaredTypeOwner;
  readonly memberName: string;
  readonly isStatic: boolean;
  readonly declarationSpans: readonly AstUtf16Span[];
  readonly declarations: readonly AstDeclaredDeclaration[];
  readonly sourceLanguage: AstDeclaredTypeLanguage;
  readonly inventoryComplete: boolean;
  /** Deterministic ordinal ranking signal, never a probability. */
  readonly rankScore: number;
  readonly rankingSignals: readonly string[];
}

export interface CallResolutionHypothesisFilterStage {
  readonly inputCount: number;
  readonly outputCount: number;
  readonly applied: boolean;
}

export interface CallResolutionCalibrationFamilyMetric {
  readonly family: string;
  readonly eligibleSiteCount: number;
  readonly top1Accuracy: number;
}

/** Integrity-bound calibration artifact. The service recomputes every derived gate. */
export interface CallResolutionCalibrationRecord {
  readonly schemaVersion: typeof CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION;
  readonly split: "calibration";
  readonly ruleSignature: string;
  readonly candidateGeneratorVersion: string;
  readonly configurationHash: string;
  readonly calibrationInputFingerprint: string;
  readonly thresholdScore: number;
  readonly independentGroupCount: number;
  readonly correctGroupCount: number;
  readonly confidenceLowerBound: number;
  readonly minimumIndependentGroups: number;
  readonly minimumConfidenceLowerBound: number;
  readonly targetFamilyMacroTop1: number;
  readonly familyMetrics: readonly CallResolutionCalibrationFamilyMetric[];
  readonly calibrationRecordHash: string;
}

export type CallResolutionStrictProofReason =
  | "unique-this-owner-member"
  | "incomplete-inventory"
  | "candidate-list-truncated"
  | "unsupported-call-shape"
  | "source-snapshot-unbound"
  | "source-snapshot-mismatch"
  | "call-site-not-in-indexed-source"
  | "no-unique-owner-candidate"
  | "unresolved-call-binding"
  | "unresolved-type-binding";

export type CallResolutionStrictProof =
  | {
      readonly status: "proven";
      readonly targetKey: string;
      readonly ruleSignature: "single-candidate-this-v1";
      readonly reason: "unique-this-owner-member";
    }
  | {
      readonly status: "abstained";
      readonly targetKey: null;
      readonly ruleSignature: null;
      readonly reason: Exclude<
        CallResolutionStrictProofReason,
        "unique-this-owner-member"
      >;
    };

export type CallResolutionHypothesisReason =
  | "calibrated-likely"
  | "uncalibrated-signature"
  | "calibration-rejected"
  | "incomplete-inventory"
  | "candidate-list-truncated"
  | "no-supported-candidates"
  | "unsupported-call-shape";

export interface CallResolutionHypothesisResult {
  readonly schemaVersion: typeof CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION;
  readonly candidateGeneratorVersion: string;
  readonly configurationHash: string;
  readonly sourceFingerprint: string;
  readonly featureInputHash: string;
  readonly ruleSignature: string;
  readonly candidateSetComplete: boolean;
  readonly truncated: boolean;
  /** Every generated key before filtering and display truncation, for recall accounting. */
  readonly generatedCandidateKeys: readonly string[];
  /** Ordered proposals after filters, bounded by configured maxCandidates. */
  readonly candidates: readonly CallResolutionHypothesisCandidate[];
  readonly filterStages: {
    readonly visibility: CallResolutionHypothesisFilterStage;
    readonly explicitReceiverType: CallResolutionHypothesisFilterStage;
    readonly peerMembers: CallResolutionHypothesisFilterStage;
    readonly argumentShape: CallResolutionHypothesisFilterStage;
  };
  readonly status: "likely" | "ambiguous";
  readonly selected: CallResolutionHypothesisCandidate | null;
  /** Calibrated group lower bound only; null for every uncalibrated/abstaining result. */
  readonly confidence: number | null;
  readonly reason: CallResolutionHypothesisReason;
  /** Strict syntax proof is separate from the calibrated heuristic decision. */
  readonly strictProof: CallResolutionStrictProof;
}

export interface CallResolutionHypothesisServiceOptions {
  readonly maxCandidates?: number;
  readonly minimumIndependentGroups?: number;
  readonly minimumConfidenceLowerBound?: number;
  readonly targetFamilyMacroTop1?: number;
  readonly calibrationRecords?: readonly CallResolutionCalibrationRecord[];
}

export interface ICallResolutionHypothesisService {
  indexWorkspace(
    input: CallResolutionHypothesisWorkspaceInput,
  ): CallResolutionHypothesisWorkspaceIndex;
  hypothesize(
    request: CallResolutionHypothesisRequest,
  ): CallResolutionHypothesisResult;
}
