import {
  SYSTEM1_EVAL_BETA_FRACTION_EPSILON,
  SYSTEM1_EVAL_BETA_FRACTION_MAX_ITERATIONS,
  SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE,
  SYSTEM1_EVAL_BETA_INVERSE_ITERATIONS,
  SYSTEM1_EVAL_CALIBRATION_METHOD,
  SYSTEM1_EVAL_LANCZOS_COEFFICIENTS,
  SYSTEM1_EVAL_LANCZOS_G,
  SYSTEM1_EVAL_LOG_TWO_PI_HALF,
  SYSTEM1_EVAL_ONE_SIDED_ALPHA,
} from "./system1-eval-constants.js";
import type {
  System1CalibrationObservation,
  System1IsotonicBlock,
  System1IsotonicCalibrator,
} from "./system1-eval-types.js";

interface MutableBlock {
  minimumScore: number;
  maximumScore: number;
  positiveCount: number;
  observationCount: number;
}

function blockRate(block: MutableBlock): number {
  return block.positiveCount / block.observationCount;
}

function freezeBlock(block: MutableBlock): System1IsotonicBlock {
  return {
    ...block,
    probability: blockRate(block),
  };
}

/** Fits deterministic pool-adjacent-violators isotonic calibration. */
export function fitSystem1IsotonicCalibrator(
  observations: readonly System1CalibrationObservation[],
): System1IsotonicCalibrator {
  const positiveCount = observations.filter(({ positive }) => positive).length;
  const negativeCount = observations.length - positiveCount;
  if (positiveCount === 0 || negativeCount === 0) {
    return {
      method: SYSTEM1_EVAL_CALIBRATION_METHOD,
      fitted: false,
      observationCount: observations.length,
      positiveCount,
      negativeCount,
      blocks: [],
    };
  }

  const sorted = [...observations].sort(
    (left, right) =>
      left.score - right.score ||
      Number(left.positive) - Number(right.positive),
  );
  const initial: MutableBlock[] = [];
  for (const observation of sorted) {
    const last = initial.at(-1);
    if (last?.minimumScore === observation.score) {
      last.observationCount += 1;
      last.positiveCount += Number(observation.positive);
    } else {
      initial.push({
        minimumScore: observation.score,
        maximumScore: observation.score,
        positiveCount: Number(observation.positive),
        observationCount: 1,
      });
    }
  }

  const pooled: MutableBlock[] = [];
  for (const item of initial) {
    pooled.push({ ...item });
    while (pooled.length >= 2) {
      const right = pooled[pooled.length - 1];
      const left = pooled[pooled.length - 2];
      if (blockRate(left) <= blockRate(right)) break;
      pooled.splice(pooled.length - 2, 2, {
        minimumScore: left.minimumScore,
        maximumScore: right.maximumScore,
        positiveCount: left.positiveCount + right.positiveCount,
        observationCount: left.observationCount + right.observationCount,
      });
    }
  }

  return {
    method: SYSTEM1_EVAL_CALIBRATION_METHOD,
    fitted: true,
    observationCount: observations.length,
    positiveCount,
    negativeCount,
    blocks: pooled.map(freezeBlock),
  };
}

/** Uses the raw score when isotonic calibration lacks both outcome classes. */
export function calibrateSystem1Score(
  calibrator: System1IsotonicCalibrator,
  rawScore: number,
): number {
  if (!calibrator.fitted || calibrator.blocks.length === 0) return rawScore;
  let selected = calibrator.blocks[0];
  for (const block of calibrator.blocks) {
    if (rawScore < block.minimumScore) break;
    selected = block;
  }
  return selected?.probability ?? rawScore;
}

function logGamma(value: number): number {
  if (value < 0.5)
    return (
      Math.log(Math.PI) -
      Math.log(Math.sin(Math.PI * value)) -
      logGamma(1 - value)
    );
  const shifted = value - 1;
  let sum = SYSTEM1_EVAL_LANCZOS_COEFFICIENTS[0];
  for (
    let index = 1;
    index < SYSTEM1_EVAL_LANCZOS_COEFFICIENTS.length;
    index += 1
  ) {
    sum += SYSTEM1_EVAL_LANCZOS_COEFFICIENTS[index] / (shifted + index);
  }
  const t = shifted + SYSTEM1_EVAL_LANCZOS_G + 0.5;
  return (
    SYSTEM1_EVAL_LOG_TWO_PI_HALF +
    (shifted + 0.5) * Math.log(t) -
    t +
    Math.log(sum)
  );
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const sum = a + b;
  const aPlusOne = a + 1;
  const aMinusOne = a - 1;
  let c = 1;
  let d = 1 - (sum * x) / aPlusOne;
  if (Math.abs(d) < SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE)
    d = SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE;
  d = 1 / d;
  let result = d;

  for (
    let iteration = 1;
    iteration <= SYSTEM1_EVAL_BETA_FRACTION_MAX_ITERATIONS;
    iteration += 1
  ) {
    const even = 2 * iteration;
    let coefficient =
      (iteration * (b - iteration) * x) / ((aMinusOne + even) * (a + even));
    d = 1 + coefficient * d;
    if (Math.abs(d) < SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE)
      d = SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE;
    c = 1 + coefficient / c;
    if (Math.abs(c) < SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE)
      c = SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE;
    d = 1 / d;
    result *= d * c;

    coefficient =
      (-(a + iteration) * (sum + iteration) * x) /
      ((a + even) * (aPlusOne + even));
    d = 1 + coefficient * d;
    if (Math.abs(d) < SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE)
      d = SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE;
    c = 1 + coefficient / c;
    if (Math.abs(c) < SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE)
      c = SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) <= SYSTEM1_EVAL_BETA_FRACTION_EPSILON) break;
  }
  return result;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const betaFactor = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log1p(-x),
  );
  const switchPoint = (a + 1) / (a + b + 2);
  if (x < switchPoint) return (betaFactor * betaContinuedFraction(a, b, x)) / a;
  return 1 - (betaFactor * betaContinuedFraction(b, a, 1 - x)) / b;
}

function validateConfidenceBoundInputs(
  successes: number,
  trials: number,
  alpha: number,
): void {
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(trials) ||
    trials < 1 ||
    successes < 0 ||
    successes > trials ||
    !(alpha > 0 && alpha < 1)
  )
    throw new RangeError("Invalid binomial confidence-bound inputs.");
}

function invertRegularizedBetaLowerTail(
  successes: number,
  trials: number,
  alpha: number,
): number {
  let lower = 0;
  let upper = successes / trials;
  for (
    let iteration = 0;
    iteration < SYSTEM1_EVAL_BETA_INVERSE_ITERATIONS;
    iteration += 1
  ) {
    const midpoint = (lower + upper) / 2;
    const cdf = regularizedIncompleteBeta(
      midpoint,
      successes,
      trials - successes + 1,
    );
    if (cdf < alpha) lower = midpoint;
    else upper = midpoint;
  }
  return (lower + upper) / 2;
}

/** Exact one-sided Clopper-Pearson lower confidence bound (95% by default). */
export function clopperPearsonLowerBound(
  successes: number,
  trials: number,
  alpha = SYSTEM1_EVAL_ONE_SIDED_ALPHA,
): number {
  validateConfidenceBoundInputs(successes, trials, alpha);
  if (successes === 0) return 0;
  if (successes === trials) return alpha ** (1 / trials);
  return invertRegularizedBetaLowerTail(successes, trials, alpha);
}
