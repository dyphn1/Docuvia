export const TDD_QUALITY_WEIGHTS = {
  positiveParameters: 0.15,
  negativeParameters: 0.15,
  inputCompleteness: 0.15,
  outputCompleteness: 0.15,
  errorHandling: 0.15,
  unexpectedInput: 0.1,
  determinism: 0.1,
  sourceTraceability: 0.05,
} as const;

export const TDD_QUALITY_MINIMUM_PASS_SCORE = 80;

export type TddQualityDimension = keyof typeof TDD_QUALITY_WEIGHTS;

export interface TddDimensionEvidence {
  passed: number;
  required: number;
  /** Required only when this dimension genuinely does not apply to the measured contract. */
  naReason?: string;
}

export interface TddQualityEvidence {
  dimensions: Record<TddQualityDimension, TddDimensionEvidence>;
  sourceConformance: "PASS" | "NON_CONFORMANT" | "SOURCE_CONFLICT";
  skippedTests: number;
}

export interface TddDimensionResult extends TddDimensionEvidence {
  applicable: boolean;
  percentage: number | null;
}

export interface TddQualityResult {
  score: number;
  result: "PASS" | "FAIL";
  dimensions: Record<TddQualityDimension, TddDimensionResult>;
  gates: {
    allApplicableDimensionsHaveEvidence: boolean;
    allRequiredChecksPass: boolean;
    sourceConformancePasses: boolean;
    noSkippedTestsCountedAsPassed: boolean;
  };
}

interface DimensionEvaluation {
  result: TddDimensionResult;
  weightedPoints: number;
  applicableWeight: number;
  requiredChecksPass: boolean;
}

const QUALITY_SCORE_TOLERANCE = 1e-9;
const DIMENSION_NAMES = Object.keys(
  TDD_QUALITY_WEIGHTS,
) as TddQualityDimension[];
const VALID_DIMENSION_NAMES = new Set<string>(DIMENSION_NAMES);

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertKnownDimensionKeys(
  dimensions: TddQualityEvidence["dimensions"],
): void {
  for (const key of Object.keys(dimensions)) {
    if (!VALID_DIMENSION_NAMES.has(key)) {
      throw new Error(`unknown TDD quality dimension: ${key}`);
    }
  }
}

function getDimensionEvidence(
  dimensions: TddQualityEvidence["dimensions"],
  dimension: TddQualityDimension,
): TddDimensionEvidence {
  const item = dimensions[dimension];
  if (!item) {
    throw new Error(`${dimension} evidence is missing`);
  }
  return item;
}

function assertDimensionEvidence(
  dimension: TddQualityDimension,
  item: TddDimensionEvidence,
): void {
  assertCount(`${dimension}.passed`, item.passed);
  assertCount(`${dimension}.required`, item.required);

  if (item.passed > item.required) {
    throw new Error(`${dimension}.passed cannot exceed required`);
  }
}

function evaluateNotApplicableDimension(
  dimension: TddQualityDimension,
  item: TddDimensionEvidence,
): DimensionEvaluation {
  if (!item.naReason?.trim()) {
    throw new Error(
      `${dimension} has no required checks; provide an explicit N/A reason instead of silently omitting evidence`,
    );
  }

  return {
    result: {
      ...item,
      applicable: false,
      percentage: null,
    },
    weightedPoints: 0,
    applicableWeight: 0,
    requiredChecksPass: true,
  };
}

function evaluateDimension(
  dimension: TddQualityDimension,
  item: TddDimensionEvidence,
): DimensionEvaluation {
  assertDimensionEvidence(dimension, item);

  if (item.required === 0) {
    return evaluateNotApplicableDimension(dimension, item);
  }

  const percentage = (item.passed / item.required) * 100;
  const weight = TDD_QUALITY_WEIGHTS[dimension];

  return {
    result: {
      ...item,
      applicable: true,
      percentage,
    },
    weightedPoints: percentage * weight,
    applicableWeight: weight,
    requiredChecksPass: item.passed === item.required,
  };
}

export function evaluateTddQuality(
  evidence: TddQualityEvidence,
): TddQualityResult {
  assertCount("skippedTests", evidence.skippedTests);
  assertKnownDimensionKeys(evidence.dimensions);

  let weightedPoints = 0;
  let applicableWeight = 0;
  let allRequiredChecksPass = true;
  let allApplicableDimensionsHaveEvidence = true;
  const dimensions = {} as Record<TddQualityDimension, TddDimensionResult>;

  for (const dimension of DIMENSION_NAMES) {
    const evaluated = evaluateDimension(
      dimension,
      getDimensionEvidence(evidence.dimensions, dimension),
    );
    dimensions[dimension] = evaluated.result;
    weightedPoints += evaluated.weightedPoints;
    applicableWeight += evaluated.applicableWeight;
    allRequiredChecksPass &&= evaluated.requiredChecksPass;
    if (evaluated.result.applicable) {
      allApplicableDimensionsHaveEvidence &&= evaluated.result.passed > 0;
    }
  }

  if (applicableWeight === 0) {
    throw new Error("at least one TDD quality dimension must be applicable");
  }

  const score = weightedPoints / applicableWeight;
  const gates = {
    allApplicableDimensionsHaveEvidence,
    allRequiredChecksPass,
    sourceConformancePasses: evidence.sourceConformance === "PASS",
    noSkippedTestsCountedAsPassed: evidence.skippedTests === 0,
  };
  const mandatoryGatesPass =
    gates.allApplicableDimensionsHaveEvidence &&
    gates.sourceConformancePasses &&
    gates.noSkippedTestsCountedAsPassed;
  const minimumScorePasses =
    score + QUALITY_SCORE_TOLERANCE >= TDD_QUALITY_MINIMUM_PASS_SCORE;

  return {
    score,
    result: mandatoryGatesPass && minimumScorePasses ? "PASS" : "FAIL",
    dimensions,
    gates,
  };
}
