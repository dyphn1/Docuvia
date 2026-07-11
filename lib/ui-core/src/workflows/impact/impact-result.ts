import type { BlastRadiusEntry, RiskLevel } from "@workspace/contracts";

export interface ImpactResult {
  blastRadius: BlastRadiusEntry[];
  riskLevel: RiskLevel;
}
