import { L3NodeTypes } from "./graph-store.interfaces.js";
import type { L3NodeType } from "./graph-store.interfaces.js";

/**
 * Cross-layer vocabulary for L3 decisions produced by analyze workflows.
 *
 * Keep the compatibility name used by analyze callers, but source the values from the
 * canonical graph-store L3 vocabulary so there is only one list of accepted node types.
 */
export const DecisionNodeType = L3NodeTypes;
export type DecisionNodeType = L3NodeType;

export interface ExtractedDecision {
  title: string;
  nodeType: DecisionNodeType;
  content: string;
  confidence: number;
}

/** Shared discriminants for every public `analyze` result shape. */
export const AnalyzeResultKind = {
  AUTO_FULL_INGESTION: "autoFullIngestion",
  AUTO_DELTA: "autoDelta",
  AUTO_DELTA_NOOP: "autoDeltaNoop",
  DECISION_EXTRACTION: "decisionExtraction",
  TIER_B_BATCH: "tierBBatch",
  FLUSH_STAGED_L3: "flushStagedL3",
} as const;

export type AnalyzeResultKind =
  (typeof AnalyzeResultKind)[keyof typeof AnalyzeResultKind];

/** Why an `analyze --agent-authored` write could not attach its decisions to an L2 node (#557). */
export const NotAttachedReasons = {
  /** No local database or no project row yet -- `docuvia init` has not run. */
  NO_GRAPH: "no-graph",
  /** The graph exists but the target file is not ingested yet (e.g. a new, uncommitted file). */
  ANCHOR_NOT_IN_GRAPH: "anchor-not-in-graph",
} as const;

export type NotAttachedReason =
  (typeof NotAttachedReasons)[keyof typeof NotAttachedReasons];
