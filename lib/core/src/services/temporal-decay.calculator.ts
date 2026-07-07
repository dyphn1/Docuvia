export function calculateTemporalDecay(updatedAt: Date, decayRate = 0.05): number {
  const now = Date.now();
  const updated = updatedAt.getTime();
  const diffDays = Math.max(0, (now - updated) / (1000 * 60 * 60 * 24));
  return Math.exp(-decayRate * diffDays);
}
