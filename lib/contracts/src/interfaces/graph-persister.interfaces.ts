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
  /** Issue #230: call sites that provably leave the analyzed project — the callee (bare call) or
   *  the receiver (member call) is bound to an import whose specifier resolves into
   *  `node_modules/`, names a `node:`-protocol builtin, or is a bare package specifier belonging
   *  to no workspace package; plus bare callees with no binding and no local declaration at all
   *  (language-level ambient globals such as `require`/`String`, and test-runner globals).
   *
   *  Excluded from health-rate denominators for the same reason `unresolvable` is: `expect()` and
   *  `path.join()` are not resolution failures, they are calls to something Docuvia never
   *  indexed and can never own a node for. On this repo they are 12,977 of 25,614 non-arg-chain
   *  sites (50.7%) — counting them as failures made the rate measure "how much of this repo is
   *  test code" rather than resolver quality.
   *
   *  Deliberately NOT counted external: a *relative* or workspace-package/tsconfig-alias
   *  specifier that fails to resolve. That is a real resolver gap and stays `unresolved`.
   *  Optional (undefined = 0) for pre-#230 producers and mocks. */
  external?: number;
  /** Issue #230: member call sites whose receiver declaration Tier A cannot see at all — the
   *  receiver is neither a symbol declared in the calling file nor a known import binding (a
   *  local `const`/parameter, which the extractor does not index, or a value returned from a
   *  call). Name matching has no handle on these, exactly like `unresolvable`'s 'arg-chain'
   *  shape; the designed escape hatch is Tier B / LSP escalation
   *  (`docuvia analyze --escalate-to-lsp`).
   *
   *  Known imprecision, stated rather than hidden: this bucket is dominated by JS builtin
   *  prototype/global methods (`arr.push`, `JSON.stringify`, `str.trim`) but does also swallow a
   *  minority of genuine project calls on DI-injected receivers (`store.insertNode`,
   *  `node.childForFieldName`). Separating those needs receiver *type* inference, which requires
   *  the extractor to capture type annotations and `new ClassName()` initializers — it does not
   *  today. Optional (undefined = 0) for pre-#230 producers and mocks. */
  unknownReceiver?: number;
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
