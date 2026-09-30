/** Discriminator values for entries in the persisted Tier C queue. */
export const TierCCandidateKinds = {
  COMMIT_MESSAGE: "commitMessage",
  CONTRACT_SYMBOL: "contractSymbol",
} as const;

export type TierCCandidateKind =
  (typeof TierCCandidateKinds)[keyof typeof TierCCandidateKinds];
