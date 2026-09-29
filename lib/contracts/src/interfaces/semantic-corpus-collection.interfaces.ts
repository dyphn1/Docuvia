/** Offline Phase 1 real-corpus collection shapes (#506). Data only; no runtime/storage types. */

/** One Tier A call site as persisted in `ast_call_sites` (0-based line/column of the callee). */
export interface SemanticCollectionCallSite {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly calleeName: string;
  readonly calleeKind: string | null;
}

/** One Tier A symbol node (`node_key` contains `#`). */
export interface SemanticCollectionGraphNode {
  readonly nodeKey: string;
  readonly name: string;
  readonly filePath: string;
}

/** One Tier A edge between node keys (a file node's key is its path). */
export interface SemanticCollectionGraphEdge {
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly kind: "calls" | "imports";
}

export interface SemanticTierACandidateSet {
  readonly candidates: readonly {
    readonly id: string;
    readonly targetId: string;
  }[];
  readonly truncated: boolean;
  readonly matchCount: number;
}

/** A declaration as seen by a checker, the oracle's target file, or an import audit. */
export interface SemanticDeclarationRef {
  readonly filePath: string;
  readonly name: string;
  readonly containerName?: string;
  readonly startLine: number;
  readonly nameLine: number;
  /** A concrete implementation (static binding) rather than a signature/interface member. */
  readonly concrete: boolean;
}

export type SemanticOracleStatus =
  "resolved" | "timeout" | "empty" | "not-ready" | "unsupported" | "error";

/** Raw per-request oracle answer before target mapping. `external` marks a location outside the
 *  snapshot; `declaration` is the in-snapshot declaration found at the location, if any. */
export type SemanticOracleAnswer =
  | {
      readonly kind: "locations";
      readonly locations: readonly {
        readonly external: boolean;
        readonly filePath: string;
        readonly declaration: SemanticDeclarationRef | null;
      }[];
    }
  | {
      readonly kind: "timeout" | "not-ready" | "error";
      readonly message: string;
    };

export interface SemanticOracleOutcome {
  readonly status: SemanticOracleStatus;
  readonly targetIds: readonly string[];
  /** Locations that were in-repo but could not be mapped to a graph node. */
  readonly unmappedLocations: number;
}

export type SemanticSourceAuditResult =
  | { readonly kind: "match"; readonly filePath: string }
  | { readonly kind: "mismatch"; readonly filePath: string }
  | { readonly kind: "not-applicable"; readonly reason: string };

export type SemanticCollectionExclusion =
  | "non-typescript-file"
  | "no-configured-project"
  | "no-identifier-at-position"
  | "checker-unresolved"
  | "external-target"
  | "same-file-target"
  | "unmappable-target";

export type SemanticSplitDropReason =
  "dedup-cross-split" | "temporal-unchanged";
