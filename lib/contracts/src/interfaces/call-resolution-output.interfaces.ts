import type {
  CallSiteResolutionClass,
  SnapshotCallResolutionRow,
  CallSiteVerificationStatus,
} from "./graph-store.interfaces.js";

/** Bounded user-facing view of one exact call site. Full stored evidence is opt-in. */
export interface CallResolutionSummary {
  callSiteKey: string | null;
  resolutionClass: CallSiteResolutionClass | "unknown";
  verificationStatus: CallSiteVerificationStatus | "unknown";
  selectedTargetNodeKey: string | null;
  confidence?: number;
  evidenceLabel?: "tier-b-verified" | "static-proof";
  isStale: boolean;
  /** Likely resolutions expose at most two alternatives to their selected top result. */
  alternatives: string[];
  /** Ambiguous resolutions expose at most three candidates in resolver order. */
  candidates: string[];
  /** Complete resolver, dependency, candidate and verification record; only with explain mode. */
  evidence?: SnapshotCallResolutionRow;
}

export interface CallResolutionImpactBreakdown {
  verifiedProven: number;
  heuristicProvisional: number;
  unknown: number;
}
