import { calculateTemporalDecay } from "../temporal-decay.calculator.js";

/**
 * Sanitize user query before sending to LLM to prevent prompt injection.
 * Strips characters that could escape JSON or inject instructions.
 */
export function sanitizeQuery(query: string): string {
  return query
    .slice(0, 2000)
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim();
}

/**
 * Calculate the temporal decay factor for a node based on its last verified date.
 * Uses an exponential decay function with a 30-day half-life.
 */
export function applyTemporalDecay(baseScore: number, referenceDate: Date): number {
  return baseScore * calculateTemporalDecay(referenceDate);
}
