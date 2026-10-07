import type {
  AstCallSiteShapeFact,
  AstCallSiteShapeFacts,
} from "./call-site-shape-facts.interfaces.js";
import type {
  AstExportDescriptor,
  AstImportDescriptor,
  AstReexportDescriptor,
} from "./ast.interfaces.js";
import type {
  AstDeclaredTypeFacts,
  AstDeclaredTypeOwner,
  AstDeclaredTypeLanguage,
  AstDeclaredDeclaration,
  AstUtf16Span,
} from "./declared-type-facts.interfaces.js";
import type { CallSiteResolutionDependency } from "./graph-store.interfaces.js";

export const CALL_RESOLUTION_CANDIDATE_GENERATOR_VERSION =
  "declared-member-hypothesis-v6" as const;
export const CALL_RESOLUTION_RANKING_POLICY_VERSION =
  "ordered-evidence-v1" as const;
export const CALL_RESOLUTION_HYPOTHESIS_SCHEMA_VERSION = 1 as const;
export const CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE =
  "q2:reexport-trace:v1" as const;
export const CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE =
  "q3:super-call:v1" as const;
export const CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE =
  "q3:this-inherited:v1" as const;
export const CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE =
  "q3:typed-receiver:v1" as const;
export const CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE =
  "q3:new-receiver:v1" as const;

/** Version and sorted signature set hashed into the current certification configuration digest. */
export const CALL_RESOLUTION_RULE_CONFIGURATION_VERSION =
  "docuvia-strict-proof-rules/v1" as const;
export const CALL_RESOLUTION_RULE_SIGNATURES = [
  "q1:named-import:v1",
  "q2:reexport-trace:v1",
  "q3:new-receiver:v1",
  "q3:super-call:v1",
  "q3:this-inherited:v1",
  "q3:typed-receiver:v1",
  "single-candidate-this-v1",
] as const;

/** SHA-256(JSON.stringify({schemaVersion:1, ruleConfigurationVersion,
 *  ruleSignatures: CALL_RESOLUTION_RULE_SIGNATURES})). Bump the manifest revision and digest
 *  whenever strict-proof implementation or configuration changes, so recertification proves
 *  that a quarantined configuration is no longer active. */
export const CALL_RESOLUTION_RULE_CONFIGURATION_SHA256 =
  "17f29ba13f08a288186c7bdbed2651248664643f98613df8d3087aade7b4f768" as const;

/** Source-bound configuration facts; unsupported mappings do not enrich candidates. */
export interface CallResolutionConfiguredPathAliases {
  readonly configurationFilePath: string;
  readonly sourceContentHash: string;
  readonly paths: Readonly<Record<string, readonly string[]>>;
  readonly baseUrl: string | null;
  readonly extends: readonly string[];
}

export interface CallResolutionHypothesisSourceFile {
  readonly filePath: string;
  /** SHA-256 of the exact source bytes used to produce this file's syntax facts. */
  readonly sourceContentHash?: string;
  /** Parser-derived direct imports from the same source bytes; absent means unavailable. */
  readonly imports?: readonly AstImportDescriptor[];
  /** Parser-derived exports from the same source bytes; absent means unavailable. */
  readonly exports?: readonly AstExportDescriptor[];
  /** Parser-derived TS/JS re-export syntax from the same bytes; absent means unavailable. */
  readonly reexports?: readonly AstReexportDescriptor[];
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
  /** Parsed once at the source boundary, from the exact hashed configuration bytes. */
  readonly configuredPathAliases?: CallResolutionConfiguredPathAliases;
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
  | "unique-named-import"
  | "unique-super-base-member"
  | "unique-inherited-this-member"
  | "unique-typed-receiver-member"
  | "unique-new-receiver-member"
  | "incomplete-inventory"
  | "candidate-list-truncated"
  | "unsupported-call-shape"
  | "source-snapshot-unbound"
  | "source-snapshot-mismatch"
  | "call-site-not-in-indexed-source"
  | "no-unique-owner-candidate"
  | "ambiguous-owner-declaration"
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
      readonly status: "proven";
      readonly targetKey: string;
      readonly ruleSignature: "q1:named-import:v1";
      readonly reason: "unique-named-import";
      readonly targetFilePath: string;
      readonly targetName: string;
      readonly dependencies: readonly CallSiteResolutionDependency[];
    }
  | {
      readonly status: "proven";
      readonly targetKey: string;
      readonly ruleSignature: typeof CALL_RESOLUTION_Q2_REEXPORT_RULE_SIGNATURE;
      readonly reason: "unique-named-import";
      readonly targetFilePath: string;
      readonly targetName: string;
      readonly dependencies: readonly CallSiteResolutionDependency[];
    }
  | {
      readonly status: "proven";
      readonly targetKey: string;
      readonly ruleSignature: typeof CALL_RESOLUTION_Q3_SUPER_CALL_RULE_SIGNATURE;
      readonly reason: "unique-super-base-member";
      readonly targetFilePath: string;
      readonly targetName: string;
      readonly targetOwnerName: string;
      readonly dependencies: readonly CallSiteResolutionDependency[];
    }
  | {
      readonly status: "proven";
      readonly targetKey: string;
      readonly ruleSignature: typeof CALL_RESOLUTION_Q3_THIS_INHERITED_RULE_SIGNATURE;
      readonly reason: "unique-inherited-this-member";
      readonly targetFilePath: string;
      readonly targetName: string;
      readonly targetOwnerName: string;
      readonly dependencies: readonly CallSiteResolutionDependency[];
    }
  | {
      readonly status: "proven";
      readonly targetKey: string;
      readonly ruleSignature: typeof CALL_RESOLUTION_Q3_TYPED_RECEIVER_RULE_SIGNATURE;
      readonly reason: "unique-typed-receiver-member";
      readonly targetFilePath: string;
      readonly targetName: string;
      readonly targetOwnerName: string;
      readonly dependencies: readonly CallSiteResolutionDependency[];
    }
  | {
      readonly status: "proven";
      readonly targetKey: string;
      readonly ruleSignature: typeof CALL_RESOLUTION_Q3_NEW_RECEIVER_RULE_SIGNATURE;
      readonly reason: "unique-new-receiver-member";
      readonly targetFilePath: string;
      readonly targetName: string;
      readonly targetOwnerName: string;
      readonly dependencies: readonly CallSiteResolutionDependency[];
    }
  | {
      readonly status: "abstained";
      readonly targetKey: null;
      readonly ruleSignature: null;
      readonly reason: Exclude<
        CallResolutionStrictProofReason,
        | "unique-this-owner-member"
        | "unique-named-import"
        | "unique-super-base-member"
        | "unique-inherited-this-member"
        | "unique-typed-receiver-member"
        | "unique-new-receiver-member"
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
