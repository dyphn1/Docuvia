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

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

export function evaluateTddQuality(
  evidence: TddQualityEvidence,
): TddQualityResult {
  assertCount("skippedTests", evidence.skippedTests);

  let weightedPoints = 0;
  let applicableWeight = 0;
  let allApplicableDimensionsHaveEvidence = true;
  let allRequiredChecksPass = true;

  const dimensions = {} as Record<TddQualityDimension, TddDimensionResult>;

  for (const dimension of Object.keys(
    TDD_QUALITY_WEIGHTS,
  ) as TddQualityDimension[]) {
    const item = evidence.dimensions[dimension];
    assertCount(`${dimension}.passed`, item.passed);
    assertCount(`${dimension}.required`, item.required);

    if (item.passed > item.required) {
      throw new Error(`${dimension}.passed cannot exceed required`);
    }

    if (item.required === 0) {
      if (!item.naReason?.trim()) {
        allApplicableDimensionsHaveEvidence = false;
        throw new Error(
          `${dimension} has no required checks; provide an explicit N/A reason instead of silently omitting evidence`,
        );
      }
      dimensions[dimension] = {
        ...item,
        applicable: false,
        percentage: null,
      };
      continue;
    }

    const percentage = (item.passed / item.required) * 100;
    const weight = TDD_QUALITY_WEIGHTS[dimension];
    applicableWeight += weight;
    weightedPoints += percentage * weight;
    allRequiredChecksPass &&= item.passed === item.required;

    dimensions[dimension] = {
      ...item,
      applicable: true,
      percentage,
    };
  }

  if (applicableWeight === 0) {
    throw new Error("at least one TDD quality dimension must be applicable");
  }

  const score = weightedPoints / applicableWeight;
  const sourceConformancePasses = evidence.sourceConformance === "PASS";
  const noSkippedTestsCountedAsPassed = evidence.skippedTests === 0;
  const passes =
    allApplicableDimensionsHaveEvidence &&
    allRequiredChecksPass &&
    sourceConformancePasses &&
    noSkippedTestsCountedAsPassed &&
    Math.abs(score - 100) < Number.EPSILON;

  return {
    score,
    result: passes ? "PASS" : "FAIL",
    dimensions,
    gates: {
      allApplicableDimensionsHaveEvidence,
      allRequiredChecksPass,
      sourceConformancePasses,
      noSkippedTestsCountedAsPassed,
    },
  };
}
