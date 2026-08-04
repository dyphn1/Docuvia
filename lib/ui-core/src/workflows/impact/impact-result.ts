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
}
