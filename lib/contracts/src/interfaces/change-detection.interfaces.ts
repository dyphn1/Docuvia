import type { IGraphStore } from "./graph-store.interfaces.js";
import type { BlastRadiusEntry, RiskLevel } from "./impact.interfaces.js";

/**
 * File-level change-detection aggregation (Domain Core logic) — mirrors old Docuvia's
 * `ChangeDetectionService.detectChanges`: resolves each changed file to its blast radius via
 * `IImpactService`, then aggregates into an overall risk level plus a human-readable summary.
 */
export interface ChangeDetectionResult {
  baseRef: string | null;
  filesChanged: Array<{ file: string; status: string }>;
  affectedNodes: Array<{ file: string; impactedBy: BlastRadiusEntry[] }>;
  riskLevel: RiskLevel;
  /** Human-readable summary — the `review` command prints this as-is. */
  analysis: string;
}

export interface IChangeDetectionService {
  detectChanges(input: {
    store: IGraphStore;
    baseRef: string | null;
    filesChanged: Array<{ file: string; status: string }>;
  }): ChangeDetectionResult;
}
