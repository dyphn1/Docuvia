import type {
  BlastRadiusEntry,
  EpistemicLevel,
  RiskLevel,
  TierBCoverageHint,
} from "@workspace/contracts";

export interface ImpactResult {
  blastRadius: BlastRadiusEntry[];
  /** Issue #192: an empty blast radius is UNKNOWN, never LOW (see `RiskLevels.UNKNOWN`). */
  riskLevel: RiskLevel;
  /** Issue #192: omitted entirely when `exact` (omit-when-confident convention) -- present with
   *  `lower-bound` whenever the edge graph's coverage behind this result is incomplete. */
  epistemic?: EpistemicLevel;
  /** Issue #192: human-readable reason attached whenever `epistemic` is lower-bound -- which
   *  coverage gap applies (partial Tier B ingestion / registry-mediated dependents / static
   *  edges only). Empty results are never silent zeros anymore. */
  riskNote?: string;
  /** Additive, omit-when-confident "not yet Tier B-processed" signal (see `TierBCoverageHint`'s
   *  own doc comment) -- attached only when an empty `blastRadius` might mean "never looked at"
   *  rather than "confirmed zero", computed one layer up from `ImpactService` (`ImpactWorkflow`). */
  tierBCoverage?: TierBCoverageHint;
  /** Issue #136: additive, omit-when-confident "the edge graph can't fully answer this" note --
   *  attached only when `blastRadius` is empty AND the resolved node's own file uses the
   *  docuviaFactory/TOKENS registry pattern, which the static edge graph does not model. Without
   *  it, "No dependents found / Risk level: LOW" reads as confident when registry-mediated
   *  cross-package dependents may simply be invisible to the edge model. */
  coverageNote?: string;
  /** Issue #192: partial coverage flag -- true when the edge graph is known to have incomplete
   *  Tier B coverage for this symbol's blast radius. Omitted when coverage is complete or unknown. */
  partialCoverage?: boolean;
}
