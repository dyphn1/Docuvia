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
  /**
   * L3 "why" data (decisions/context) attached to this node, when any exists — populated by
   * `ImpactService.getBlastRadius` from `IL3NodesRepo.getByL2NodeId`. Omitted (not an empty
   * array) when the node has no L3 rows, so existing `toEqual`-style assertions on a plain
   * `{ name, type }` entry keep passing.
   */
  why?: Array<{ title: string; content: string | null }>;
}

export interface IImpactService {
  /**
   * LOW/MEDIUM/HIGH/CRITICAL derivation from a raw impacted-node count, scaled against `store`'s
   * current total `l2_nodes` count (typescript-cli-benchmark.md's
   * impact-risk-thresholds-not-scaled-to-repo-size fix) -- `store` is required, not optional,
   * matching `getBlastRadius`'s own store-first convention on this interface: a caller silently
   * omitting the denominator would just as silently reintroduce the unscaled-absolute-count bug
   * this fixes.
   */
  computeRiskLevel(store: IGraphStore, impactedCount: number): RiskLevel;
  /**
   * 1-hop blast radius (direct callers/dependents) for `target`, resolved exact-then-LIKE.
   * Undefined when `target` doesn't resolve to any node.
   */
  getBlastRadius(
    store: IGraphStore,
    target: string,
  ): BlastRadiusEntry[] | undefined;
}
