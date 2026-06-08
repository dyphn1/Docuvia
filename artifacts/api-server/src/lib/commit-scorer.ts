export function scoreCommit(message: string, diff?: string): number {
  const msg = message.toLowerCase();
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
  ];
  for (const p of noisePatterns) {
    if (p.test(msg)) return 0.1;
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
  let score = 0.3;
  for (const p of signalPatterns) {
    if (p.test(msg)) score += 0.15;
  }
  if (message.length > 50) score += 0.1;

  if (diff) {
    if (diff.includes("TODO") || diff.includes("FIXME")) {
      score += 0.1;
    }
    const lines = diff.split("\n").length;
    if (lines > 100) {
      score += 0.1;
    }
  }

  return Math.min(score, 1.0);
}
