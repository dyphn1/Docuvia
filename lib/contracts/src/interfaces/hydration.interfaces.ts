import type { IGraphStore } from "./graph-store.interfaces.js";

/** Result of `IHydrationService.hydrate()` — see `docs/gitbook/adr/storage/STOR-002-sqlite-ephemeral-query-engine.md`'s Hydration Flow. */
export interface HydrationResult {
  /** `false` when there is nothing to hydrate from yet (e.g. `init` hasn't run / knowledge branch doesn't exist). */
  hydrated: boolean;
  /** The knowledge-branch commit hydrated from — the nearest-ancestor match for the current source HEAD, or the branch tip. Undefined when `hydrated` is `false`. */
  knowledgeSha?: string;
  nodesLoaded: number;
  edgesLoaded: number;
  edgesDropped: number;
}

/**
 * Docuvia-specific hydration semantics (STOR-002) built on `IGitProvider`'s raw primitives —
 * parses `graph/*.jsonl` off the resolved knowledge-branch commit and bulk-loads it into
 * `IGraphStore` via `bulkLoadGraph`.
 */
export interface IHydrationService {
  /**
   * Resolves which knowledge-branch commit corresponds to the current source `HEAD` (STOR-002's
   * "Source-Commit Lookup"): the nearest ancestor of `HEAD` among commits whose `Docuvia-Source`
   * trailer was stamped on the knowledge branch, falling back to the branch tip when no stamped
   * commit matches (e.g. all-legacy/unstamped history, or a source HEAD unrelated to any stamp).
   * `undefined` when the knowledge branch doesn't exist yet.
   */
  resolveHydrationCommit(
    cwd: string,
    branchName?: string,
  ): Promise<string | undefined>;
  /** Hydrates `store` from the resolved knowledge-branch commit and records its sha in `store.meta` for future staleness checks. A no-op (`hydrated: false`) when there's nothing to hydrate from yet. */
  hydrate(
    cwd: string,
    store: IGraphStore,
    branchName?: string,
  ): Promise<HydrationResult>;
  /**
   * `true` when `store`'s recorded tip sha (`store.meta`) no longer matches what
   * `resolveHydrationCommit` resolves to right now — i.e. `store` needs (re-)hydrating. Note this
   * re-resolves fresh rather than comparing against the branch tip, because the correct commit to
   * hydrate from can change even when the branch tip hasn't moved (e.g. the source repo checked
   * out a different branch). `false` when there's nothing to hydrate from yet (an empty
   * `local.db` in that state isn't "stale", just uninitialized).
   */
  isStale(
    cwd: string,
    store: IGraphStore,
    branchName?: string,
  ): Promise<boolean>;
  /**
   * Records the current knowledge-branch commit in `store.meta` *without* touching `store.graph`
   * — for callers (e.g. `init`) whose local graph was just populated directly (not hydrated from
   * git) and would otherwise look "stale" to the very next `isStale()` check, since `store.meta`
   * was never set. A no-op when the knowledge branch doesn't exist yet.
   */
  markSynced(
    cwd: string,
    store: IGraphStore,
    branchName?: string,
  ): Promise<void>;
}
