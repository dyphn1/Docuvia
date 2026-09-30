import type { TierCCandidateKinds } from "../constants/tier-c-queue.js";

interface TierCQueueEntryBase {
  /** Dedup key: a commit sha for `commitMessage`, a node key for `contractSymbol`. */
  target: string;
  /** Commit sha associated with this candidate; equals `target` for `commitMessage`. */
  commitSha: string;
  /** Consecutive extraction failures; persisted values must be non-negative integers. */
  failCount?: number;
}

/** Persisted candidate generated from a commit message. */
export interface TierCCommitMessageEntry extends TierCQueueEntryBase {
  kind: typeof TierCCandidateKinds.COMMIT_MESSAGE;
  /** Full commit message captured at enqueue time. */
  message: string;
}

/** Persisted candidate generated from a contract-symbol change. */
export interface TierCContractSymbolEntry extends TierCQueueEntryBase {
  kind: typeof TierCCandidateKinds.CONTRACT_SYMBOL;
  /** Repo-relative source file containing the changed contract symbol. */
  file: string;
}

/** A persisted Tier C queue entry, discriminated by its extraction source. */
export type TierCQueueEntry =
  TierCCommitMessageEntry | TierCContractSymbolEntry;
