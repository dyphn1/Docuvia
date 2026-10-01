import type {
  System1DatasetRecord,
  System1LabelRecord,
  System1Split,
} from "../system1-types.js";
import type {
  SYSTEM1_EVAL_CERTIFICATION_MODES,
  SYSTEM1_EVAL_OOF_DIAGNOSTIC_KINDS,
  SYSTEM1_EVAL_TRAINING_MODES,
} from "./system1-eval-constants.js";

export type System1EvalCertificationMode =
  (typeof SYSTEM1_EVAL_CERTIFICATION_MODES)[keyof typeof SYSTEM1_EVAL_CERTIFICATION_MODES];
export type System1OOFDiagnosticKind =
  (typeof SYSTEM1_EVAL_OOF_DIAGNOSTIC_KINDS)[keyof typeof SYSTEM1_EVAL_OOF_DIAGNOSTIC_KINDS];
export type System1ScorerTrainingMode =
  (typeof SYSTEM1_EVAL_TRAINING_MODES)[keyof typeof SYSTEM1_EVAL_TRAINING_MODES];
import {
  SYSTEM1_EVAL_ACTIONS,
  SYSTEM1_EVAL_SCORER_STATUSES,
  SYSTEM1_EVAL_SLICE_DIMENSIONS,
  SYSTEM1_EVAL_THRESHOLD_STATUSES,
} from "./system1-eval-constants.js";

export type System1EvalScorerStatus =
  (typeof SYSTEM1_EVAL_SCORER_STATUSES)[keyof typeof SYSTEM1_EVAL_SCORER_STATUSES];
export type System1EvalAction =
  (typeof SYSTEM1_EVAL_ACTIONS)[keyof typeof SYSTEM1_EVAL_ACTIONS];
export type System1EvalThresholdStatus =
  (typeof SYSTEM1_EVAL_THRESHOLD_STATUSES)[keyof typeof SYSTEM1_EVAL_THRESHOLD_STATUSES];
export type System1EvalSliceDimension =
  (typeof SYSTEM1_EVAL_SLICE_DIMENSIONS)[keyof typeof SYSTEM1_EVAL_SLICE_DIMENSIONS];

export interface System1ScorerResponse {
  readonly requestId: string;
  readonly status: System1EvalScorerStatus;
  readonly scoreKind: "raw";
  readonly scores: Readonly<Record<string, number>>;
  readonly foldFamily?: string;
}

export interface System1RepoFamilyFold {
  readonly foldFamily: string;
  readonly trainingFamilies: readonly string[];
}

export interface System1ScorerTrainingManifest {
  readonly mode: System1ScorerTrainingMode;
  readonly foldTrainingFamilies: Readonly<Record<string, readonly string[]>>;
  readonly heldOutTrainingFamilies: readonly string[];
}

export interface System1OOFFamilyPrecision {
  readonly family: string;
  readonly commits: number;
  readonly exactSetCount: number;
  readonly exactSetPrecision: number | null;
  readonly lowerBound: number | null;
  readonly usedForFamilyGate: boolean;
  readonly familyGateSatisfied: boolean | null;
}

export interface System1OOFFamilyTable {
  readonly diagnosticKind: System1OOFDiagnosticKind;
  readonly evaluatedThreshold: number | null;
  readonly families: readonly System1OOFFamilyPrecision[];
  readonly pooledCommitCount: number;
  readonly pooledExactSetCount: number;
  readonly pooledLowerBound: number | null;
  readonly worstFamilyLowerBound: number | null;
}

/** State-only scorer callback shared by in-process TypeScript implementations. */
export interface System1InProcessScorer {
  readonly scorerId: string;
  readonly version: string;
  readonly weightsConfigSha256: string;
  readonly scoreState: (
    state: System1DatasetRecord,
  ) => unknown | Promise<unknown>;
}

export interface System1EvalExample {
  readonly split: System1Split;
  readonly state: System1DatasetRecord;
  readonly labels: System1LabelRecord;
  readonly response: System1ScorerResponse;
}

export interface System1CalibrationObservation {
  readonly score: number;
  readonly positive: boolean;
}

export interface System1IsotonicBlock {
  readonly minimumScore: number;
  readonly maximumScore: number;
  readonly positiveCount: number;
  readonly observationCount: number;
  readonly probability: number;
}

export interface System1IsotonicCalibrator {
  readonly method: string;
  readonly fitted: boolean;
  readonly observationCount: number;
  readonly positiveCount: number;
  readonly negativeCount: number;
  readonly blocks: readonly System1IsotonicBlock[];
}

export interface System1PrecisionThreshold {
  readonly targetPrecision: number;
  readonly status: System1EvalThresholdStatus;
  readonly threshold: number | null;
  readonly calibrationCommitCount: number;
  readonly calibrationExactSetCount: number;
  readonly lowerBound: number | null;
  readonly oofFamilyTable?: System1OOFFamilyTable;
  readonly oofFamilyDiagnostics?: readonly System1OOFFamilyTable[];
}

export interface System1EvaluationPolicy {
  readonly schemaVersion: number;
  readonly calibrationMethod: string;
  readonly scorerManifestHash: string;
  readonly calibrator: System1IsotonicCalibrator;
  readonly precisionTargets: readonly System1PrecisionThreshold[];
  readonly certificationMode?: System1EvalCertificationMode;
  readonly minFamilyCommits?: number;
  readonly folds?: readonly System1RepoFamilyFold[];
  readonly foldCalibrationSummaries?: readonly {
    readonly foldFamily: string;
    readonly trainingFamilies: readonly string[];
    readonly observationCount: number;
    readonly calibrationSha256: string;
  }[];
  readonly certificationRule?: Readonly<Record<string, unknown>>;
}

export interface System1DecisionResult {
  readonly requestId: string;
  readonly action: System1EvalAction;
  readonly acceptedCandidateIds: readonly string[];
  readonly acceptedTargetIds: readonly string[];
}

export interface System1ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
}

export interface System1RateMetric {
  readonly numerator: number;
  readonly denominator: number;
  readonly rate: number | null;
  readonly interval95: System1ConfidenceInterval | null;
}

export interface System1ReliabilityBin {
  readonly index: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly sampleCount: number;
  readonly meanConfidence: number | null;
  readonly observedRate: System1RateMetric;
}

export interface System1CalibrationMetrics {
  readonly method: string;
  readonly scoredRequestCount: number;
  readonly candidateCount: number;
  readonly ece: number | null;
  readonly reliability: readonly System1ReliabilityBin[];
}

export interface System1RequestLevelMetrics {
  readonly commitRate: System1RateMetric;
  readonly lspAvoidanceRate: System1RateMetric;
  readonly exactSetPrecision: System1RateMetric;
  readonly unknownRate: System1RateMetric;
  readonly verifyRate: System1RateMetric;
  readonly abstentionRate: System1RateMetric;
  readonly falseSafePerTrustedRequest: System1RateMetric;
  readonly falseSafeAmongCommits: System1RateMetric;
  readonly candidateMissCommits: number;
}

export interface System1CandidateLevelMetrics {
  readonly acceptedDecisionPrecision: System1RateMetric;
  readonly goldPositiveCoverage: System1RateMetric;
  readonly falsePositiveRate: System1RateMetric;
  readonly top1Accuracy: System1RateMetric;
}

export interface System1TargetMetrics {
  readonly targetPrecision: number;
  readonly certification: System1PrecisionThreshold;
  readonly requestLevel: System1RequestLevelMetrics;
  readonly candidateLevel: System1CandidateLevelMetrics;
}

export interface System1SliceMetrics {
  readonly dimension: System1EvalSliceDimension;
  readonly key: string;
  readonly sampleCount: number;
  readonly trustedRequestCount: number;
  readonly candidateMissCount: number;
  readonly calibration: System1CalibrationMetrics;
  readonly byPrecisionTarget: Readonly<Record<string, System1TargetMetrics>>;
}

export interface System1SplitMetrics {
  readonly split: System1Split;
  readonly sampleCount: number;
  readonly trustedRequestCount: number;
  readonly excludedLabelCounts: Readonly<Record<string, number>>;
  readonly candidateMissCount: number;
  readonly calibration: System1CalibrationMetrics;
  readonly byPrecisionTarget: Readonly<Record<string, System1TargetMetrics>>;
  readonly slices: readonly System1SliceMetrics[];
}
