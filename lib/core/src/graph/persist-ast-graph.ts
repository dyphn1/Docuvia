import {
  type IGraphPersister,
  type IGraphStore,
  type ParsedAstFileResult,
  type CallResolutionStats,
  aggregateCallResolution,
  L2NodeTypes,
  LinkTypes,
} from "@workspace/contracts";
import { ScopeResolver } from "./scope-resolver.js";
import { ANONYMOUS_SYMBOL_NAME } from "../constants/symbols.js";
import { buildUniqueNodeKey, buildQualifiedBaseKey } from "./node-key.js";

/** Mutable per-file accumulator `linkSymbolReference` increments while resolving one file's
 *  call sites (issue #221, extended by #230). `unresolved` is derived at close time (`total`
 *  minus every classified bucket) so the hot path only touches the incrementing fields. */
type CallResolutionCounters = {
  total: number;
  resolved: number;
  selfDiscarded: number;
  unresolvable: number;
  external: number;
  unknownReceiver: number;
};

function newCallResolutionCounters(): CallResolutionCounters {
  return {
    total: 0,
    resolved: 0,
    selfDiscarded: 0,
    unresolvable: 0,
    external: 0,
    unknownReceiver: 0,
  };
}

function closeCallResolutionCounters(
  counters: CallResolutionCounters,
): CallResolutionStats {
  return {
    total: counters.total,
    resolved: counters.resolved,
    selfDiscarded: counters.selfDiscarded,
    unresolvable: counters.unresolvable,
    external: counters.external,
    unknownReceiver: counters.unknownReceiver,
    unresolved:
      counters.total -
      counters.resolved -
      counters.selfDiscarded -
      counters.unresolvable -
      counters.external -
      counters.unknownReceiver,
  };
}

/**
 * Redistributes old `SqliteGraphRepository.persistAstGraph()`'s logic onto `IGraphStore`'s
 * named repo primitives.
 *
 * `persistLocked` runs its whole body inside `store.withTransaction()` (added specifically for
 * this class — see that method's doc comment), restoring old `persistAstGraphUnlocked`'s
 * single-`db.transaction()` all-or-nothing atomicity on top of the write-lock's serialization.
 * Previously each named repo call auto-committed on its own; at vscode-repo scale, once
 * `ScopeResolver` correctly resolved hundreds of thousands of `calls`/`extends`/`implements`
 * edges instead of silently dropping most of them, one fsync per row turned persist into a
 * practically-infinite operation (docs/cli-test-analysis/typescript-cli-benchmark.md).
 */
export class GraphPersisterService implements IGraphPersister {
  public async persist(input: {
    store: IGraphStore;
    workspaceRoot: string;
    projectId: number;
    parsedResults: ParsedAstFileResult[];
    tags: string[];
  }): Promise<{
    updatedCount: number;
    callResolution?: CallResolutionStats;
    callResolutionByFile?: Record<string, CallResolutionStats>;
  }> {
    const { store, workspaceRoot, projectId, parsedResults, tags } = input;

    return store.withWriteLock(() =>
      this.persistLocked(store, workspaceRoot, projectId, parsedResults, tags),
    );
  }

  /**
   * Core of `persist()`, run inside `store.withWriteLock()`. The whole body runs inside
   * `store.withTransaction()` (one BEGIN/COMMIT instead of one autocommit per `insertNode`/
   * `insertLink` call) — restores the old `db.transaction()`-wrapped behavior this class's own
   * class-level doc comment flags as a known gap, now load-bearing: at vscode-repo scale, one
   * fsync per row made a full persist practically never finish (see `IGraphStore.withTransaction`'s
   * doc comment).
   */
  private persistLocked(
    store: IGraphStore,
    workspaceRoot: string,
    projectId: number,
    parsedResults: ParsedAstFileResult[],
    tags: string[],
  ): {
    updatedCount: number;
    callResolution?: CallResolutionStats;
    callResolutionByFile?: Record<string, CallResolutionStats>;
  } {
    return store.withTransaction(() => {
      const resolver = new ScopeResolver(workspaceRoot);
      this.registerResolverFiles(resolver, parsedResults);

      const fileIdMap = new Map<string, number>();
      // Per-file map of symbol name -> l2_nodes.id, so calls/implements/extends can link to the
      // actual function/class node instead of collapsing to a file-to-file edge.
      const symbolIdMap = new Map<string, Map<string, number>>();

      // Issue #221: per-file Tier A call-site resolution counters, aggregated for the caller
      // (the orchestration layer stamps them into docuvia_meta / the analyze log).
      const callResolutionByFile: Record<string, CallResolutionStats> = {};

      this.upsertTags(store, tags);
      // Suspends l2_nodes_fts's sync triggers for the duration of this per-file insert/delete
      // loop (see `IGraphStore.withFtsSyncSuspended`'s doc comment) -- without it, per-row FTS5
      // tokenization across 293k+ nodes was the other half (alongside the missing transaction
      // wrap) of why a vscode-scale persist's WAL grew unboundedly and eventually failed with
      // SQLite's own "disk I/O error".
      store.graph.withFtsSyncSuspended(() => {
        this.persistFileAndSymbolNodes(
          store,
          projectId,
          parsedResults,
          tags,
          fileIdMap,
          symbolIdMap,
        );
      });
      const updatedCount = this.linkParsedResults(
        store,
        resolver,
        projectId,
        parsedResults,
        fileIdMap,
        symbolIdMap,
        callResolutionByFile,
      );

      const files = Object.keys(callResolutionByFile);
      const callResolution =
        files.length > 0
          ? aggregateCallResolution(callResolutionByFile)
          : undefined;

      return { updatedCount, callResolution, callResolutionByFile };
    });
  }

  /** Registers every parsed file's imports/locals with the resolver up front, so cross-file
   *  call/implements/extends resolution below can see the whole batch, not just files processed
   *  so far. */
  private registerResolverFiles(
    resolver: ScopeResolver,
    parsedResults: ParsedAstFileResult[],
  ): void {
    for (const result of parsedResults) {
      const locals: string[] = [];
      if (result.data.functions)
        locals.push(...result.data.functions.map((f) => f.name));
      if (result.data.classes)
        locals.push(...result.data.classes.map((c) => c.name));
      // Issue #192 gap 1: exported consts count as local symbols too -- without them a barrel
      // re-exporting a const can't be chained to the defining file, and resolveCall's own-file
      // check misses them.
      if (result.data.variables)
        locals.push(...result.data.variables.map((v) => v.name));
      resolver.registerFile(result.file, result.data.imports || [], [], locals);
    }
  }

  private upsertTags(store: IGraphStore, tags: string[]): void {
    for (const tag of tags) {
      store.tags.upsertTag(tag);
    }
  }

  /** Inserts a file node (plus its function/class symbol nodes) for every parsed result,
   *  populating `fileIdMap`/`symbolIdMap` for the linking pass below. */
  private persistFileAndSymbolNodes(
    store: IGraphStore,
    projectId: number,
    parsedResults: ParsedAstFileResult[],
    tags: string[],
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
  ): void {
    for (const result of parsedResults) {
      // Delete any stale nodes (and their outgoing links/tag-links) for this path so a
      // re-parsed file's old graph state doesn't linger.
      store.graph.deleteNodesForPath(result.file);

      // Same delete-then-reinsert-on-reparse symmetry as l2_nodes above, for the raw call-site
      // positions Tier B's forward resolution pass (issue #11 plan A, Slice 3) seeds itself
      // from -- ast_call_sites holds one row per call site regardless of whether ScopeResolver
      // below manages to resolve it locally (see 0008_ast_call_sites.sql's header comment).
      store.callSites.deleteForFile(projectId, result.file);
      store.callSites.insertMany(
        projectId,
        result.file,
        (result.data.calls ?? []).map((c) => ({
          targetFunction: c.targetFunction,
          startLine: c.startLine,
          startColumn: c.startColumn,
          calleeName: c.calleeName,
          receiverText: c.receiverText,
          calleeKind: c.calleeKind,
        })),
      );

      const fileId = store.graph.insertNode({
        projectId,
        name: result.file,
        type: L2NodeTypes.MODULE,
        description: "",
        pathPatterns: [result.file],
        nodeKey: result.file,
        contentHash: result.hash,
      });
      fileIdMap.set(result.file, fileId);
      const symbolsForFile = new Map<string, number>();
      symbolIdMap.set(result.file, symbolsForFile);

      this.linkFileToTags(store, fileId, tags);

      // Two symbols in the same file can share a name (multiple truly-anonymous callbacks all
      // named "anonymous" by resolveCallableName(), overloaded functions, same-named methods on
      // different classes, chained/nested callbacks sharing a start line, ...). node_key is
      // `${file}#${name}` and UNIQUE(project_id, node_key), so a second insert under an
      // already-used key would throw. Disambiguate only on actual collision, preferring the
      // symbol's start line (readable, usually enough) and falling back to a counter for the
      // rare case where even that repeats (e.g. `x.map(() => {}).filter(() => {})` on one line) —
      // guaranteed unique, so the common non-colliding case keeps its plain `file#name` key.
      const usedNodeKeys = new Set<string>([result.file]);
      this.insertFunctionNodes(
        store,
        projectId,
        result,
        fileId,
        symbolsForFile,
        usedNodeKeys,
      );
      this.insertClassNodes(
        store,
        projectId,
        result,
        fileId,
        symbolsForFile,
        usedNodeKeys,
      );
      this.insertVariableNodes(
        store,
        projectId,
        result,
        fileId,
        symbolsForFile,
        usedNodeKeys,
      );
    }
  }

  private linkFileToTags(
    store: IGraphStore,
    fileId: number,
    tags: string[],
  ): void {
    for (const tag of tags) {
      const tagId = store.tags.getIdByName(tag);
      if (tagId !== undefined) store.tags.linkNodeToTag(fileId, tagId);
    }
  }

  private insertFunctionNodes(
    store: IGraphStore,
    projectId: number,
    result: ParsedAstFileResult,
    fileId: number,
    symbolsForFile: Map<string, number>,
    usedNodeKeys: Set<string>,
  ): void {
    for (const fn of result.data.functions ?? []) {
      const nodeKey = buildUniqueNodeKey(
        usedNodeKeys,
        buildQualifiedBaseKey(result.file, fn.name, fn.containerName),
        fn.startLine,
      );
      usedNodeKeys.add(nodeKey);
      const fnId = store.graph.insertNode({
        projectId,
        name: fn.name,
        type: L2NodeTypes.MODULE,
        description: "",
        pathPatterns: [result.file],
        nodeKey,
        contentHash: fn.contentHash,
      });
      symbolsForFile.set(fn.name, fnId);
      store.graph.insertLink({
        sourceNodeId: fileId,
        targetNodeId: fnId,
        linkType: LinkTypes.CONTAINS,
      });
    }
  }

  private insertClassNodes(
    store: IGraphStore,
    projectId: number,
    result: ParsedAstFileResult,
    fileId: number,
    symbolsForFile: Map<string, number>,
    usedNodeKeys: Set<string>,
  ): void {
    for (const cls of result.data.classes ?? []) {
      const nodeKey = buildUniqueNodeKey(
        usedNodeKeys,
        `${result.file}#${cls.name}`,
        cls.startLine,
      );
      usedNodeKeys.add(nodeKey);
      const clsId = store.graph.insertNode({
        projectId,
        name: cls.name,
        type: L2NodeTypes.MODULE,
        description: "",
        pathPatterns: [result.file],
        nodeKey,
        contentHash: cls.contentHash,
      });
      symbolsForFile.set(cls.name, clsId);
      store.graph.insertLink({
        sourceNodeId: fileId,
        targetNodeId: clsId,
        linkType: LinkTypes.CONTAINS,
      });
    }
  }

  /** Issue #192 gap 1: exported `const X = ...` declarations become symbol nodes (same
   *  MODULE type + `${file}#${name}` key convention as functions/classes -- identity is carried
   *  entirely by the key, so no new node type is needed) so impact/query can resolve them. */
  private insertVariableNodes(
    store: IGraphStore,
    projectId: number,
    result: ParsedAstFileResult,
    fileId: number,
    symbolsForFile: Map<string, number>,
    usedNodeKeys: Set<string>,
  ): void {
    for (const variable of result.data.variables ?? []) {
      const nodeKey = buildUniqueNodeKey(
        usedNodeKeys,
        `${result.file}#${variable.name}`,
        variable.startLine,
      );
      usedNodeKeys.add(nodeKey);
      const variableId = store.graph.insertNode({
        projectId,
        name: variable.name,
        type: L2NodeTypes.MODULE,
        description: "",
        pathPatterns: [result.file],
        nodeKey,
        contentHash: variable.contentHash,
      });
      symbolsForFile.set(variable.name, variableId);
      store.graph.insertLink({
        sourceNodeId: fileId,
        targetNodeId: variableId,
        linkType: LinkTypes.CONTAINS,
      });
    }
  }

  /** Links calls/implements/extends edges for every parsed result and upserts its file row.
   *  Returns the number of files processed (matches old `updatedCount` semantics). */
  private linkParsedResults(
    store: IGraphStore,
    resolver: ScopeResolver,
    projectId: number,
    parsedResults: ParsedAstFileResult[],
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    callResolutionByFile: Record<string, CallResolutionStats>,
  ): number {
    let updatedCount = 0;

    for (const result of parsedResults) {
      const sourceFileId = fileIdMap.get(result.file);
      if (!sourceFileId) continue;

      const counters = newCallResolutionCounters();
      this.linkParsedResultRelations(
        store,
        resolver,
        result,
        sourceFileId,
        fileIdMap,
        symbolIdMap,
        counters,
      );
      if (counters.total > 0) {
        callResolutionByFile[result.file] =
          closeCallResolutionCounters(counters);
      }

      store.files.upsertFile({
        projectId,
        filePath: result.file,
        contentHash: result.hash,
      });
      updatedCount++;
    }

    return updatedCount;
  }

  private linkParsedResultRelations(
    store: IGraphStore,
    resolver: ScopeResolver,
    result: ParsedAstFileResult,
    sourceFileId: number,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    counters: CallResolutionCounters,
  ): void {
    const sourceSymbols = symbolIdMap.get(result.file);

    for (const call of result.data.calls ?? []) {
      this.linkSymbolReference(
        store,
        resolver,
        result.file,
        sourceFileId,
        sourceSymbols,
        fileIdMap,
        symbolIdMap,
        call.sourceFunction,
        call.targetFunction,
        LinkTypes.CALLS,
        false,
        counters,
        {
          calleeName: call.calleeName,
          receiverText: call.receiverText,
          calleeKind: call.calleeKind,
        },
      );
    }
    for (const impl of result.data.implements ?? []) {
      this.linkSymbolReference(
        store,
        resolver,
        result.file,
        sourceFileId,
        sourceSymbols,
        fileIdMap,
        symbolIdMap,
        impl.sourceClass,
        impl.targetInterface,
        LinkTypes.IMPLEMENTS,
        true,
      );
    }
    for (const ext of result.data.extends ?? []) {
      this.linkSymbolReference(
        store,
        resolver,
        result.file,
        sourceFileId,
        sourceSymbols,
        fileIdMap,
        symbolIdMap,
        ext.sourceClass,
        ext.targetClass,
        LinkTypes.EXTENDS,
        true,
      );
    }
    for (const spawn of result.data.workerSpawns ?? []) {
      this.linkWorkerSpawn(
        store,
        resolver,
        result.file,
        sourceFileId,
        sourceSymbols,
        fileIdMap,
        symbolIdMap,
        spawn.sourceFunction,
        spawn.targetPath,
      );
    }
    this.linkReexports(
      store,
      resolver,
      result,
      sourceFileId,
      fileIdMap,
      symbolIdMap,
    );
  }

  /** Issue #192 gap 2: a barrel re-export (`export { X } from "../deep/util"`) is a real
   *  file-level dependency -- the barrel breaks if its source moves, even though it has no call
   *  sites. Resolves the descriptor through the ScopeResolver (whose re-export chaining lands on
   *  the defining file) and inserts a `depends_on` edge from the barrel's FILE node. */
  private linkReexports(
    store: IGraphStore,
    resolver: ScopeResolver,
    result: ParsedAstFileResult,
    sourceFileId: number,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
  ): void {
    for (const imp of result.data.imports ?? []) {
      if (!imp.viaReexport) continue;
      this.linkReexport(
        store,
        resolver,
        result.file,
        sourceFileId,
        fileIdMap,
        symbolIdMap,
        imp.localName,
      );
    }
  }

  private linkReexport(
    store: IGraphStore,
    resolver: ScopeResolver,
    sourceFile: string,
    sourceFileId: number,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    localName: string,
  ): void {
    const resolved = resolver.resolveCall(sourceFile, localName);
    if (!resolved) return;
    const targetNodeId = this.resolveTargetNodeId(
      store,
      fileIdMap,
      symbolIdMap,
      resolved.targetFile,
      resolved.targetSymbol,
    );
    if (!targetNodeId || targetNodeId === sourceFileId) return;
    store.graph.insertLink({
      sourceNodeId: sourceFileId,
      targetNodeId,
      linkType: LinkTypes.DEPENDS_ON,
    });
  }

  /** Resolves one `new Worker(<path>)` spawn site (TS/JS only — see `ast-worker.ts`'s
   *  `collectWorkerSpawns`) to its target file and, if resolved, inserts a `DEPENDS_ON` edge from
   *  the spawning function/file to the spawned worker script's file node. Mirrors
   *  `linkSymbolReference`'s shape, but resolves by relative file path
   *  (`ScopeResolver.resolveWorkerSpawnPath`) rather than by imported symbol name — a
   *  `new Worker(...)` call names a script file to run in a new thread, not an imported
   *  binding, so the target is always the whole file node (`targetFile` doubles as the
   *  `targetSymbol` argument to `resolveTargetNodeId`, hitting its file-node fallback). */
  private linkWorkerSpawn(
    store: IGraphStore,
    resolver: ScopeResolver,
    sourceFile: string,
    sourceFileId: number,
    sourceSymbols: Map<string, number> | undefined,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    sourceFunctionName: string | undefined,
    targetPath: string,
  ): void {
    const targetFile = resolver.resolveWorkerSpawnPath(sourceFile, targetPath);
    if (!targetFile) return;

    const targetNodeId = this.resolveTargetNodeId(
      store,
      fileIdMap,
      symbolIdMap,
      targetFile,
      targetFile,
    );
    if (!targetNodeId) return;

    const sourceNodeId = this.resolveSourceNodeId(
      sourceSymbols,
      sourceFunctionName,
      sourceFileId,
    );

    if (targetNodeId !== sourceNodeId) {
      store.graph.insertLink({
        sourceNodeId,
        targetNodeId,
        linkType: LinkTypes.DEPENDS_ON,
      });
    }
  }

  /** Issue #192: a call site is structurally unresolvable by name matching when its shape has
   *  no statically nameable callee — an invocation-result receiver (`expect(x).toEqual`,
   *  `'arg-chain'`), computed access (`obj[expr]()`, `'computed'`), or (pre-0012 rows /
   *  unknown shapes) raw text carrying call parentheses. */
  private isUnresolvableCallShape(
    targetFunctionOrClass: string,
    memberCall?: {
      calleeKind?: "bare" | "member" | "this" | "arg-chain" | "computed";
    },
  ): boolean {
    const calleeKind = memberCall?.calleeKind;
    return (
      calleeKind === "arg-chain" ||
      calleeKind === "computed" ||
      (!calleeKind && targetFunctionOrClass.includes("("))
    );
  }

  /** Member/this-shaped calls resolve through `resolveMemberCall` (receiver-aware); every other
   *  shape takes the classic bare-name `resolveCall`. Returns null when neither matches --
   *  still an unresolved site, never a guess.
   *
   *  Issue #230: member/this shapes no longer fall through to `resolveCall`. That fallback
   *  passed the *whole dotted callee text* (`"service.doSomething"`) to a matcher that only ever
   *  compares bare names, so it could not match anything -- dead code, measured across 13,884
   *  member/this sites on this repo. It is not re-pointed at `calleeName` instead: a bare
   *  project-wide match on a terminal method name is precisely the `Add`/`Close` false-edge
   *  hazard `useNameFallback`'s doc comment keeps off calls, and this graph's ~99% edge precision
   *  is the asset worth protecting. */
  private resolveCallTarget(
    resolver: ScopeResolver,
    sourceFile: string,
    targetFunctionOrClass: string,
    memberCall?: {
      calleeName?: string;
      receiverText?: string;
      calleeKind?: "bare" | "member" | "this" | "arg-chain" | "computed";
    },
  ): { targetFile: string; targetSymbol: string } | null {
    const calleeKind = memberCall?.calleeKind;
    if (
      (calleeKind === "member" || calleeKind === "this") &&
      memberCall?.calleeName &&
      memberCall.receiverText
    ) {
      return resolver.resolveMemberCall(
        sourceFile,
        memberCall.receiverText,
        memberCall.calleeName,
      );
    }
    return resolver.resolveCall(sourceFile, targetFunctionOrClass);
  }

  /**
   * Issue #230: classifies an *unresolved* call site as a structural limit rather than a
   * resolution failure, so health rates measure resolver quality instead of how much of the
   * analyzed repo is test code. Returns the counter to charge, or null to leave the site
   * genuinely `unresolved`.
   *
   * Order matters: externality is proven from the binding first (a `node_modules` receiver is
   * external whether or not its declaration is visible), and only receivers with no binding and
   * no local declaration fall through to `unknownReceiver`.
   */
  private classifyUnresolvedCall(
    resolver: ScopeResolver,
    sourceFile: string,
    targetFunctionOrClass: string,
    memberCall?: {
      calleeName?: string;
      receiverText?: string;
      calleeKind?: "bare" | "member" | "this" | "arg-chain" | "computed";
    },
  ): "external" | "unknownReceiver" | null {
    const receiver =
      memberCall?.calleeKind === "member" ? memberCall.receiverText : undefined;
    // A member call's origin is decided by its receiver; a bare call's, by the callee itself.
    if (
      resolver.isExternalBinding(sourceFile, receiver ?? targetFunctionOrClass)
    ) {
      return "external";
    }
    // `this`/`super` receivers are deliberately not classified here: a missed `this.method()`
    // means the method lives in a base class elsewhere, which is a real gap, not a limit.
    if (receiver)
      return this.classifyUnresolvedReceiver(resolver, sourceFile, receiver);
    if (memberCall?.calleeKind !== "bare") return null;
    return this.classifyUnresolvedBareCallee(
      resolver,
      sourceFile,
      targetFunctionOrClass,
    );
  }

  /** A member receiver that is neither imported nor declared in the calling file has no
   *  statically knowable type — see `CallResolutionStats.unknownReceiver`. */
  private classifyUnresolvedReceiver(
    resolver: ScopeResolver,
    sourceFile: string,
    receiver: string,
  ): "unknownReceiver" | null {
    const visible =
      resolver.hasBinding(sourceFile, receiver) ||
      resolver.declaresLocal(sourceFile, receiver);
    return visible ? null : "unknownReceiver";
  }

  /** A bare callee with neither an import binding nor a local declaration is a language-level
   *  ambient global (`require`, `String`) or a runner-injected one (`describe`, `it` under
   *  vitest's globals mode). Nothing in the project could ever own a node for it. */
  private classifyUnresolvedBareCallee(
    resolver: ScopeResolver,
    sourceFile: string,
    calleeName: string,
  ): "external" | null {
    const visible =
      resolver.hasBinding(sourceFile, calleeName) ||
      resolver.declaresLocal(sourceFile, calleeName);
    return visible ? null : "external";
  }

  /** Resolves one call/implements/extends edge and, if the resolved target is a real (and
   *  distinct) node, inserts the link. Mirrors old inline `processLink` closure 1:1.
   *
   *  `useNameFallback` (implements/extends only, not calls): `ScopeResolver.resolveCall()` only
   *  resolves same-file locals and explicitly-imported names — a JS/TS-shaped model. Base
   *  classes/interfaces are routinely visible without any import in C# (same namespace), Java/Go
   *  (same package), etc., so falling back to a project-wide exact/LIKE name lookup
   *  (`findNodeByName`, the same heuristic `docuvia impact`/`query` already use — see IMPT-001)
   *  is what actually lets those languages' extends/implements edges resolve cross-file. Left off
   *  calls, where a common short method name (`Add`, `Close`, ...) would false-match far more
   *  often than a class/interface name would. */
  private linkSymbolReference(
    store: IGraphStore,
    resolver: ScopeResolver,
    sourceFile: string,
    sourceFileId: number,
    sourceSymbols: Map<string, number> | undefined,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    sourceSymbolName: string | undefined,
    targetFunctionOrClass: string,
    linkType: string,
    useNameFallback = false,
    callCounters?: CallResolutionCounters,
    memberCall?: {
      calleeName?: string;
      receiverText?: string;
      calleeKind?: "bare" | "member" | "this" | "arg-chain" | "computed";
    },
  ): void {
    if (callCounters) callCounters.total++;

    // Issue #192: shape-classified calls take the member-resolution path. 'arg-chain'
    // (receiver is itself an invocation) and 'computed' (`obj[expr]()`) have no statically
    // nameable callee -- counted as unresolvable (excluded from health denominators), not as
    // resolution failures.
    if (this.isUnresolvableCallShape(targetFunctionOrClass, memberCall)) {
      if (callCounters) callCounters.unresolvable++;
      return;
    }
    const resolved = this.resolveCallTarget(
      resolver,
      sourceFile,
      targetFunctionOrClass,
      memberCall,
    );
    const outcome = this.insertResolvedLink(
      store,
      resolved,
      targetFunctionOrClass,
      useNameFallback,
      sourceSymbols,
      sourceSymbolName,
      sourceFileId,
      fileIdMap,
      symbolIdMap,
      linkType,
    );
    if (!callCounters) return;
    if (outcome === "linked") {
      callCounters.resolved++;
      return;
    }
    if (outcome === "self-discarded") {
      callCounters.selfDiscarded++;
      return;
    }
    // Issue #230: a site that produced no edge is only a *failure* if the thing it names could
    // have had a node. Charge the structural buckets first; whatever is left stays `unresolved`
    // (derived in `closeCallResolutionCounters`).
    const structural = this.classifyUnresolvedCall(
      resolver,
      sourceFile,
      targetFunctionOrClass,
      memberCall,
    );
    if (structural === "external") callCounters.external++;
    else if (structural === "unknownReceiver") callCounters.unknownReceiver++;
  }

  /** Resolves `resolved` (or the implements/extends name fallback) to concrete node ids and
   *  inserts the edge unless it degenerates to a self-call -- which is tracked separately
   *  from unresolved (persisted nowhere by design).
   *
   *  Reports which of the three happened so `linkSymbolReference` owns all counter policy in one
   *  place (issue #230 added two more buckets, and splitting that decision across both methods
   *  is how they drift). */
  private insertResolvedLink(
    store: IGraphStore,
    resolved: { targetFile: string; targetSymbol: string } | null,
    targetFunctionOrClass: string,
    useNameFallback: boolean,
    sourceSymbols: Map<string, number> | undefined,
    sourceSymbolName: string | undefined,
    sourceFileId: number,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    linkType: string,
  ): "linked" | "self-discarded" | "no-target" {
    const targetNodeId = resolved
      ? this.resolveTargetNodeId(
          store,
          fileIdMap,
          symbolIdMap,
          resolved.targetFile,
          resolved.targetSymbol,
        )
      : useNameFallback
        ? store.graph.findNodeByName(targetFunctionOrClass)?.id
        : undefined;
    if (!targetNodeId) return "no-target";

    const sourceNodeId = this.resolveSourceNodeId(
      sourceSymbols,
      sourceSymbolName,
      sourceFileId,
    );

    // Self-call: the site resolved to the caller's own node -- structurally unresolvable into a
    // usable edge by design (persisted nowhere), so tracked separately from unresolved and
    // excluded from health-rate denominators.
    if (targetNodeId === sourceNodeId) return "self-discarded";

    store.graph.insertLink({ sourceNodeId, targetNodeId, linkType });
    return "linked";
  }

  /** Prefers the specific target function/class node; falls back to the file node when the
   *  target isn't a tracked symbol (e.g. a re-exported value or namespace import). */
  private resolveTargetNodeId(
    store: IGraphStore,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    targetFile: string,
    targetSymbol: string,
  ): number | undefined {
    return (
      symbolIdMap.get(targetFile)?.get(targetSymbol) ??
      store.graph.findNodeIdByName(targetFile, targetSymbol) ??
      fileIdMap.get(targetFile) ??
      store.graph.findNodeIdByName(targetFile, targetFile)
    );
  }

  /** Prefers the specific calling function/class node; falls back to the file node for
   *  module-level (top-level) call sites. */
  private resolveSourceNodeId(
    sourceSymbols: Map<string, number> | undefined,
    sourceSymbolName: string | undefined,
    sourceFileId: number,
  ): number {
    const symbolId =
      sourceSymbolName && sourceSymbolName !== ANONYMOUS_SYMBOL_NAME
        ? sourceSymbols?.get(sourceSymbolName)
        : undefined;
    return symbolId ?? sourceFileId;
  }
}
