export const SCORER_CONSTANTS = {
  BASE_SCORE: 0.3,
  SIGNAL_BONUS: 0.15,
  VALID_THRESHOLD: 0.4,
  DETAIL_BONUS_LENGTH: 50,
  DETAIL_BONUS_AMOUNT: 0.1,
  BOT_PENALTY_SCORE: 0.1,
  DIFF_DEBT_BONUS: 0.1,
  DIFF_LENGTH_BONUS: 0.1,
  DIFF_LENGTH_THRESHOLD: 100,
  MAX_SCORE: 1.0,
};

export function scoreCommit(message?: string, diff?: string): { score: number; valid: boolean } {
  if (!message) return { score: SCORER_CONSTANTS.BOT_PENALTY_SCORE, valid: false };

  // No need to lower-case manually if we use /i regex flags
  const noisePatterns = [
    /^merge (pull request|branch)/i,
    /^bump version/i,
    /^chore:/i,
    /^auto-generated/i,
    /^ci:/i,
    /^wip:/i,
    /^revert /i,
    /^initial commit/i,
    /^update changelog/i,
    /^\[skip ci\]/i,
    /dependabot\[bot\]/i,
    /chore\(release\):/i,
  ];

  for (const p of noisePatterns) {
    if (p.test(message)) return { score: SCORER_CONSTANTS.BOT_PENALTY_SCORE, valid: false };
  }

  const signalPatterns = [
    /\bfix(ed|es|ing)?\b/i,
    /\bfeat(ure)?\b/i,
    /\badd(ed|s|ing)?\b/i,
    /\brefactor/i,
    /\bimplements?\b/i,
    /\bresolves?\b/i,
    /\bbreaking change\b/i,
    /\bdecision\b/i,
    /\barchitecture\b/i,
    /\bperformance\b/i,
  ];

  let score = SCORER_CONSTANTS.BASE_SCORE;
  for (const p of signalPatterns) {
    if (p.test(message)) score += SCORER_CONSTANTS.SIGNAL_BONUS;
  }

  if (message.length > SCORER_CONSTANTS.DETAIL_BONUS_LENGTH) {
    score += SCORER_CONSTANTS.DETAIL_BONUS_AMOUNT;
  }

  if (diff) {
    if (diff.includes("FIXME") || diff.includes("HACK")) {
      score += SCORER_CONSTANTS.DIFF_DEBT_BONUS;
    }
    const lines = (diff.match(/\n/g)?.length ?? 0) + 1;

    if (lines > SCORER_CONSTANTS.DIFF_LENGTH_THRESHOLD) {
      score += SCORER_CONSTANTS.DIFF_LENGTH_BONUS;
    }
  }

  const finalScore = Math.min(score, SCORER_CONSTANTS.MAX_SCORE);
  return {
    score: finalScore,
    valid: finalScore >= SCORER_CONSTANTS.VALID_THRESHOLD,
  };
}
