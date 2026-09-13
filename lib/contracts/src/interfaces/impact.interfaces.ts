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
  /**
   * Issue #192: an empty upstream (blast-radius) result is `UNKNOWN`, never `LOW` -- absence of
   * static edges (calls/implements/extends only) is NOT evidence that no code depends on the
   * target. Runtime-variable imports, computed `import()` specifiers, and `child_process` spawns
   * produce no edge, so a zero can never be trusted as a confident answer. Mirrors GitNexus's
   * impact-risk semantics ("never a false-safe zero"); downstream/outgoing emptiness is exempt,
   * but `docuvia impact` only ever reports the upstream direction.
   */
  UNKNOWN: "UNKNOWN",
} as const;

export type RiskLevel = (typeof RiskLevels)[keyof typeof RiskLevels];

/**
 * Issue #192: how completely the edge graph observed the dependency surface behind an impact
 * result. `EXACT` results omit the field entirely (omit-when-confident convention); any
 * `LOWER_BOUND` result carries a human-readable `riskNote` explaining which coverage gap applies.
 */
export const EpistemicLevels = {
  EXACT: "exact",
  LOWER_BOUND: "lower-bound",
} as const;

export type EpistemicLevel =
  (typeof EpistemicLevels)[keyof typeof EpistemicLevels];

/** Issue #393: persisted status of one runtime dependency expression. `BOUNDED` means static
 * evidence proves a finite local candidate set; it is still not a confirmed runtime edge.
 * `UNRESOLVED` means static analysis cannot prove a useful finite candidate set. */
export const DynamicDependencyStatuses = {
  BOUNDED: "bounded",
  UNRESOLVED: "unresolved",
} as const;
export type DynamicDependencyStatus =
  (typeof DynamicDependencyStatuses)[keyof typeof DynamicDependencyStatuses];

export const DynamicDependencyKinds = {
  DYNAMIC_IMPORT: "dynamic-import",
} as const;
export type DynamicDependencyKind =
  (typeof DynamicDependencyKinds)[keyof typeof DynamicDependencyKinds];

/**
 * Issue #393: explicit evidence for a runtime dependency boundary. These records are persisted
 * separately from `node_links`: candidatePaths are possible targets justified by the expression,
 * never silently promoted into confirmed graph edges. Source position + raw expression are kept
 * so impact output can explain exactly why a result is a lower bound.
 */
export interface DynamicDependencyEvidence {
  sourceFile: string;
  kind: DynamicDependencyKind;
  expression: string;
  startLine: number;
  startColumn: number;
  literalPrefix?: string;
  literalSuffix?: string;
  status: DynamicDependencyStatus;
  candidatePaths: string[];
  reason: string;
}

/**
 * Issue #217/#393: which source produced a blast-radius entry. Static entries (`node_links`
 * incoming edges) OMIT the field entirely (omit-when-confident convention). `lsp-fallback`
 * identifies an unresolved call-site recovery; `dynamic-candidate` identifies a source file that
 * is only a statically-bounded candidate for a runtime dependency and therefore must retain
 * lower-bound epistemic semantics.
 */
export const BlastRadiusEdgeSources = {
  LSP_FALLBACK: "lsp-fallback",
  DYNAMIC_CANDIDATE: "dynamic-candidate",
} as const;

export type BlastRadiusEdgeSource =
  (typeof BlastRadiusEdgeSources)[keyof typeof BlastRadiusEdgeSources];

export interface BlastRadiusEntry {
  name: string;
  type: string;
  /** Omitted for confirmed static edges; present for fallback/candidate evidence. */
  edgeSource?: BlastRadiusEdgeSource;
  /** Issue #393 provenance for a `dynamic-candidate` entry. */
  dynamicEvidence?: DynamicDependencyEvidence;
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
  /** Issue #393: target-relevant bounded candidates plus globally-unbounded runtime evidence.
   * Optional for compatibility with test doubles/alternate implementations predating #393. */
  getDynamicEvidence?(
    store: IGraphStore,
    target: string,
  ): DynamicDependencyEvidence[];
}
