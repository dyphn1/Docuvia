import type { IGraphStore } from "./graph-store.interfaces.js";
import type { ParsedAstFileResult } from "./ast.interfaces.js";

/** Issue #221: Tier A call-site resolution outcome counters for one file (or an aggregate).
 *  `unresolved` is the silent-drop case (`linkSymbolReference` returning without inserting a
 *  link); `selfDiscarded` counts call sites whose resolved target equals their own source node
 *  (structurally unresolvable by design, so excluded from health-rate denominators). */ export interface CallResolutionStats {
  total: number;
  resolved: number;
  selfDiscarded: number;
  unresolved: number;
  /** Issue #192: call sites classified as structurally unresolvable by name matching
   *  (`callee_kind` 'arg-chain' -- receiver is itself an invocation, e.g.
   *  `expect(x).toEqual` -- or 'computed', `obj[expr]()`). Excluded from health-rate
   *  denominators alongside `selfDiscarded`: they are not resolution failures, they are not
   *  name-resolvable calls at all. Optional (undefined = 0) so pre-#192 producers and mocks
   *  keep satisfying the interface unchanged. */
  unresolvable?: number;
}

/**
 * Turns parsed AST results into knowledge-graph nodes/edges — Docuvia's core semantic-graph
 * construction logic (Domain Core), built entirely on `IGraphStore`'s repo interfaces.
 */
export interface IGraphPersister {
  persist(input: {
    store: IGraphStore;
    workspaceRoot: string;
    projectId: number;
    parsedResults: ParsedAstFileResult[];
    tags: string[];
  }): Promise<{
    updatedCount: number;
    /** Issue #221: per-run aggregate + per-file call-site resolution counters. Optional so
     *  existing mock persisters keep satisfying the interface unchanged. */
    callResolution?: CallResolutionStats;
    callResolutionByFile?: Record<string, CallResolutionStats>;
  }>;
}
