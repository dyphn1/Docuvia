import type { IGraphStore } from "./graph-store.interfaces.js";

/**
 * Blast-radius risk scoring (Domain Core logic — see
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Domain Core section, which
 * names blast-radius calculation and risk scoring directly as `lib/core` responsibilities).
 * Shared by the standalone `docuvia impact <target>` command and `review`'s per-file
 * aggregation, so the two never drift apart on what counts as "risky".
 */
export const RiskLevels = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;

export type RiskLevel = (typeof RiskLevels)[keyof typeof RiskLevels];

export interface BlastRadiusEntry {
  name: string;
  type: string;
}

export interface IImpactService {
  /** LOW/MEDIUM/HIGH/CRITICAL derivation from a raw impacted-node count. */
  computeRiskLevel(impactedCount: number): RiskLevel;
  /**
   * 1-hop blast radius (direct callers/dependents) for `target`, resolved exact-then-LIKE.
   * Undefined when `target` doesn't resolve to any node.
   */
  getBlastRadius(
    store: IGraphStore,
    target: string,
  ): BlastRadiusEntry[] | undefined;
}
