import type {
  BlastRadiusEntry,
  RiskLevel,
  TierBCoverageHint,
} from "@workspace/contracts";

export interface ImpactResult {
  blastRadius: BlastRadiusEntry[];
  riskLevel: RiskLevel;
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
}
