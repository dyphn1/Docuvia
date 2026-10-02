import type {
  SemanticCorpusSplit,
  SemanticDecisionRequest,
} from "@workspace/contracts";
import {
  SYSTEM1_AMBIGUITY_CLASSES,
  SYSTEM1_BARREL_STATUSES,
  SYSTEM1_CALL_KINDS,
  SYSTEM1_DECLARATION_KINDS,
  SYSTEM1_EVIDENCE_STATUSES,
  SYSTEM1_IMPORT_KINDS,
  SYSTEM1_TIER_A_EVIDENCE,
  SYSTEM1_TIER_A_RANKS,
} from "./system1-constants.js";

export type System1CallKind =
  (typeof SYSTEM1_CALL_KINDS)[keyof typeof SYSTEM1_CALL_KINDS];
export type System1TierARank =
  (typeof SYSTEM1_TIER_A_RANKS)[keyof typeof SYSTEM1_TIER_A_RANKS];
export type System1TierAEvidence =
  (typeof SYSTEM1_TIER_A_EVIDENCE)[keyof typeof SYSTEM1_TIER_A_EVIDENCE];
export type System1DeclarationKind =
  (typeof SYSTEM1_DECLARATION_KINDS)[keyof typeof SYSTEM1_DECLARATION_KINDS];
export type System1EvidenceStatus =
  (typeof SYSTEM1_EVIDENCE_STATUSES)[keyof typeof SYSTEM1_EVIDENCE_STATUSES];
export type System1ImportKind =
  (typeof SYSTEM1_IMPORT_KINDS)[keyof typeof SYSTEM1_IMPORT_KINDS];
export type System1BarrelStatus =
  (typeof SYSTEM1_BARREL_STATUSES)[keyof typeof SYSTEM1_BARREL_STATUSES];
export type System1AmbiguityClass =
  (typeof SYSTEM1_AMBIGUITY_CLASSES)[keyof typeof SYSTEM1_AMBIGUITY_CLASSES];

export interface System1ImportBinding {
  readonly kind: System1ImportKind;
  readonly local: string;
  readonly imported: string;
  readonly sourceSpecifier: string;
  readonly barrelStatus: System1BarrelStatus;
  readonly pathAlias: boolean | null;
}

export interface System1CandidateInput {
  readonly id: string;
  readonly targetId: string;
  readonly tierARank: System1TierARank;
  readonly tierAEvidence: System1TierAEvidence;
  readonly evidenceStatus: System1EvidenceStatus;
  readonly declarationKind: System1DeclarationKind;
  readonly signatureSnippet: string;
  readonly overloadCount: number | null;
  readonly generatedMarker: boolean | null;
  readonly forwardingWrapper: boolean | null;
}

/** State-only input. Corpus oracle/review/checker fields are intentionally absent. */
export interface System1StateInput {
  readonly sampleId: string;
  readonly repoId: string;
  readonly worktreeId: string;
  readonly projectId: string;
  readonly snapshotHash: string;
  readonly candidateSetTruncated: boolean;
  readonly caller: {
    readonly filePath: string;
    readonly symbol: string;
  };
  readonly call: {
    readonly calleeName: string;
    readonly expression: string;
    readonly sourceWindow: string;
    readonly sourceWindowTruncated: boolean;
    readonly kind: System1CallKind;
    readonly receiverHint: string | null;
    readonly genericHints: readonly string[];
  };
  readonly importBinding: System1ImportBinding | null;
  readonly candidates: readonly System1CandidateInput[];
}

export interface System1AmbiguityEvidence {
  readonly call: {
    readonly calleeName: string;
    readonly kind: System1CallKind;
    readonly receiverName: string | null;
    readonly receiverLocallyBound: boolean | null;
    readonly receiverImported: boolean | null;
    readonly receiverTypeKnown: boolean | null;
    readonly fluentChain: boolean | null;
    readonly genericTypeArguments: readonly string[] | null;
    readonly stringLiteralArguments: readonly string[] | null;
    readonly namespaceCall: boolean | null;
    readonly boundedComputedImport: boolean | null;
    readonly frameworkConvention: boolean | null;
  };
  readonly importBinding: System1ImportBinding | null;
  readonly candidates: readonly System1CandidateInput[];
}

export interface System1AmbiguityClassification {
  readonly tags: readonly System1AmbiguityClass[];
  readonly notDetected: readonly System1AmbiguityClass[];
}

export interface System1DatasetRecord {
  readonly request: SemanticDecisionRequest;
  readonly ambiguityClasses: readonly System1AmbiguityClass[];
  readonly notDetectedClasses: readonly System1AmbiguityClass[];
  readonly candidateCount: number;
  readonly textTruncated: boolean;
}

export interface System1LabelsInput {
  readonly requestId: string;
  readonly candidateTargetIds: readonly string[];
  readonly positiveTargetIds: readonly string[];
  readonly negativeTargetIds: readonly string[];
  readonly reviewStatus: string;
  readonly oracleStatus: string;
}

export interface System1LabelRecord {
  readonly requestId: string;
  readonly positiveTargetIds: readonly string[];
  readonly negativeTargetIds: readonly string[];
  readonly reviewStatus: string;
  readonly oracleStatus: string;
  readonly candidateMiss: boolean;
}

export type System1Split = SemanticCorpusSplit;
export type System1Usage = "evaluation-only" | "training-and-evaluation";
