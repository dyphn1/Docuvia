import {
  type ExternalIncomingLink,
  type CallSiteResolutionProjectionCallerInput,
  type ICallResolutionHypothesisService,
  type IGraphPersister,
  type IGraphStore,
  type ParsedAstFileResult,
  type CallResolutionStats,
  aggregateCallResolution,
  L2NodeTypes,
  LinkTypes,
  DocuviaError,
  ErrorCodes,
  CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX,
  CallsProjectionCallerPolicies,
  DEFAULT_CALLS_PROJECTION_CALLER_POLICY,
  type CallsProjectionCallerPolicy,
} from "@workspace/contracts";
import { ScopeResolver } from "./scope-resolver.js";
import { ANONYMOUS_SYMBOL_NAME } from "../constants/symbols.js";
import { buildUniqueNodeKey, buildQualifiedBaseKey } from "./node-key.js";
import {
  collectStrictCallSiteProofs,
  createFunctionNodeReference,
  exactCallerNodeForCall,
  isSha256,
  portableCallSiteKeyForCall,
  sourceContentHashForProof,
  sourceManifestFingerprint,
  type CallSiteProof,
  type FunctionNodeReference,
  type StrictCallProofExclusion,
} from "./call-resolution-graph-projection.js";

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
  constructor(
    private readonly hypothesisService?: ICallResolutionHypothesisService,
    private readonly callsProjectionCallerPolicy: CallsProjectionCallerPolicy = DEFAULT_CALLS_PROJECTION_CALLER_POLICY,
  ) {}

  public async persist(input: {
    store: IGraphStore;
    workspaceRoot: string;
    projectId: number;
    parsedResults: ParsedAstFileResult[];
    tags: string[];
    sourceIndexComplete?: boolean;
  }): Promise<{
    updatedCount: number;
    callResolution?: CallResolutionStats;
    callResolutionByFile?: Record<string, CallResolutionStats>;
    strictCallProofExclusions?: readonly StrictCallProofExclusion[];
  }> {
    const {
      store,
      workspaceRoot,
      projectId,
      parsedResults,
      tags,
      sourceIndexComplete,
    } = input;

    return store.withWriteLock(() =>
      this.persistLocked(
        store,
        workspaceRoot,
        projectId,
        parsedResults,
        tags,
        sourceIndexComplete === true,
      ),
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
    sourceIndexComplete: boolean,
  ): {
    updatedCount: number;
    callResolution?: CallResolutionStats;
    callResolutionByFile?: Record<string, CallResolutionStats>;
    strictCallProofExclusions?: readonly StrictCallProofExclusion[];
  } {
    return store.withTransaction(() => {
      const resolver = new ScopeResolver(workspaceRoot);
      this.registerResolverFiles(resolver, parsedResults);

      // #508 Phase 3 D9: incoming edges from files outside this batch point at node ids the
      // per-file replace below is about to delete. Capture them by node_key first and re-attach
      // them after the re-insert, or every unchanged dependent of a re-parsed file is lost.
      const externalIncoming = store.graph.getExternalIncomingLinks(
        parsedResults.map((result) => result.file),
      );

      const fileIdMap = new Map<string, number>();
      // Per-file map of symbol name -> l2_nodes.id, so calls/implements/extends can link to the
      // actual function/class node instead of collapsing to a file-to-file edge.
      const symbolIdMap = new Map<string, Map<string, number>>();
      const functionNodeRefsByFile = new Map<string, FunctionNodeReference[]>();

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
          functionNodeRefsByFile,
          this.callsProjectionCallerPolicy,
        );
      });
      const strictProofProjectionWillRun = this.canPersistStrictCallSiteProofs(
        store,
        parsedResults,
        sourceIndexComplete,
      );
      const updatedCount = this.linkParsedResults(
        store,
        resolver,
        projectId,
        parsedResults,
        fileIdMap,
        symbolIdMap,
        functionNodeRefsByFile,
        this.callsProjectionCallerPolicy,
        callResolutionByFile,
        !strictProofProjectionWillRun,
      );
      const strictCallProofExclusions = this.persistStrictCallSiteProofs(
        store,
        projectId,
        parsedResults,
        sourceIndexComplete,
        fileIdMap,
        symbolIdMap,
        functionNodeRefsByFile,
        resolver,
        this.callsProjectionCallerPolicy,
      );
      this.reattachExternalIncomingLinks(store, externalIncoming);
      if (sourceIndexComplete) {
        store.meta.set(
          `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}${projectId}`,
          this.callsProjectionCallerPolicy,
        );
      }

      const files = Object.keys(callResolutionByFile);
      const callResolution =
        files.length > 0
          ? aggregateCallResolution(callResolutionByFile)
          : undefined;

      return {
        updatedCount,
        callResolution,
        callResolutionByFile,
        strictCallProofExclusions,
      };
    });
  }

  /**
   * Issue #508 Phase 3 (D9): re-attaches incoming edges from files outside the batch to the
   * re-inserted nodes by `node_key` (the identity PLAT-007 already relies on for Tier B). A key
   * that no longer resolves means the symbol was removed or renamed, so its edge is correctly
   * dropped. Sources are outside the batch, so the linking pass never inserted the same edge.
   */
  private reattachExternalIncomingLinks(
    store: IGraphStore,
    links: readonly ExternalIncomingLink[],
  ): void {
    for (const link of links) {
      const targetNodeId = store.graph.findNodeIdByNodeKey(link.targetNodeKey);
      if (targetNodeId === undefined) continue;
      store.graph.insertLink({
        sourceNodeId: link.sourceNodeId,
        targetNodeId,
        linkType: link.linkType,
      });
    }
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
      resolver.registerFile(
        result.file,
        (result.data.imports || []).filter(
          (descriptor) => !descriptor.isCombinedDefaultImport,
        ),
        [],
        locals,
      );
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
    functionNodeRefsByFile: Map<string, FunctionNodeReference[]>,
    callerPolicy: CallsProjectionCallerPolicy,
  ): void {
    for (const result of parsedResults) {
      // Current per-site decisions are file-version scoped: retire them with the old symbols
      // before inserting the freshly parsed graph. Append-only observations remain available.
      store.callSiteResolutions?.deleteForFile(projectId, result.file);

      // Delete any stale nodes (and their links, both directions, and tag-links) for this path
      // so a re-parsed file's old graph state doesn't linger. External incoming edges were
      // captured by node_key in persistLocked and are re-attached after linking (#508 D9).
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
      const functionNodeRefs: FunctionNodeReference[] = [];
      functionNodeRefsByFile.set(result.file, functionNodeRefs);

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
        functionNodeRefs,
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
      if (callerPolicy === CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2) {
        this.linkLexicalFunctionContainment(
          store,
          symbolsForFile,
          functionNodeRefs,
        );
      }
    }
  }

  /**
   * Persists exact-caller-v2 lexical context separately from file ownership. Nested functions use
   * `lexical_parent`; a function without an enclosing function span uses `lexical_owner` when the
   * parser identifies a class/struct owner. The owner edge is terminal for impact. Every symbol
   * keeps its file `contains` edge, and equal or crossing spans stay unlinked because caller
   * projection falls back to the file for ties.
   */
  private linkLexicalFunctionContainment(
    store: IGraphStore,
    symbolsForFile: ReadonlyMap<string, number>,
    functionNodes: readonly FunctionNodeReference[],
  ): void {
    for (const child of functionNodes) {
      if (child.graphNodeId === undefined) continue;
      const enclosingFunctions = functionNodes.filter(
        (candidate) =>
          candidate !== child &&
          candidate.graphNodeId !== undefined &&
          candidate.startLine <= child.startLine &&
          candidate.endLine >= child.endLine &&
          (candidate.startLine < child.startLine ||
            candidate.endLine > child.endLine),
      );
      if (enclosingFunctions.length > 0) {
        const smallestSpan = Math.min(
          ...enclosingFunctions.map(
            (candidate) => candidate.endLine - candidate.startLine,
          ),
        );
        const innermost = enclosingFunctions.filter(
          (candidate) =>
            candidate.endLine - candidate.startLine === smallestSpan,
        );
        const [parent] = innermost;
        if (innermost.length === 1 && parent?.graphNodeId !== undefined) {
          store.graph.insertLink({
            sourceNodeId: parent.graphNodeId,
            targetNodeId: child.graphNodeId,
            linkType: LinkTypes.LEXICAL_PARENT,
          });
        }
        continue;
      }

      // A class/struct member function or field initializer has no enclosing function span.
      // Attach it to its owner when known; ordinary top-level functions remain file children.
      if (child.containerName === undefined) continue;
      const classId = symbolsForFile.get(child.containerName);
      if (classId === undefined) continue;
      store.graph.insertLink({
        sourceNodeId: classId,
        targetNodeId: child.graphNodeId,
        linkType: LinkTypes.LEXICAL_OWNER,
      });
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
    functionNodeRefs: FunctionNodeReference[],
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
      functionNodeRefs.push(
        createFunctionNodeReference(result, fn, nodeKey, fnId),
      );
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
    functionNodeRefsByFile: Map<string, FunctionNodeReference[]>,
    callerPolicy: CallsProjectionCallerPolicy,
    callResolutionByFile: Record<string, CallResolutionStats>,
    persistCallerCandidates: boolean,
  ): number {
    let updatedCount = 0;

    for (const result of parsedResults) {
      const sourceFileId = fileIdMap.get(result.file)!;

      const counters = newCallResolutionCounters();
      this.linkParsedResultRelations(
        store,
        resolver,
        result,
        sourceFileId,
        fileIdMap,
        symbolIdMap,
        functionNodeRefsByFile.get(result.file) ?? [],
        callerPolicy,
        counters,
        persistCallerCandidates,
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

  /** Persists source-bound Q1/Q2/Q3 proofs for a complete source index. Every call edge starts
   *  under the active caller policy; the per-site projection replaces a proved target and then
   *  restores unproven sites under that same policy inside the transaction. */
  private persistStrictCallSiteProofs(
    store: IGraphStore,
    projectId: number,
    parsedResults: ParsedAstFileResult[],
    sourceIndexComplete: boolean,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    functionNodeRefsByFile: Map<string, FunctionNodeReference[]>,
    resolver: ScopeResolver,
    callerPolicy: CallsProjectionCallerPolicy,
  ): StrictCallProofExclusion[] {
    const repo = store.callSiteResolutions;
    const service = this.hypothesisService;
    if (
      !this.canPersistStrictCallSiteProofs(
        store,
        parsedResults,
        sourceIndexComplete,
      )
    )
      return [];
    if (!repo || !service) return [];

    const workspaceIndex = service.indexWorkspace({
      sourceFingerprint: sourceManifestFingerprint(
        parsedResults,
        sourceIndexComplete,
      ),
      sourceIndexComplete,
      sourceFiles: parsedResults.map((result) => ({
        filePath: result.file,
        sourceContentHash: sourceContentHashForProof(result),
        imports: result.data.imports ?? [],
        exports: result.data.exports ?? [],
        reexports: result.data.reexports,
        callSiteShapeFacts: result.data.callSiteShapeFacts ?? null,
        declaredTypeFacts: result.data.declaredTypeFacts ?? null,
      })),
    });
    const nodeKeyById = new Map<number, string>(
      store.graph
        .getAllNodes()
        .flatMap((node) =>
          node.project_id === projectId && node.node_key
            ? [[node.id, node.node_key] as const]
            : [],
        ),
    );

    const exclusions: StrictCallProofExclusion[] = [];
    for (const result of parsedResults) {
      exclusions.push(
        ...this.persistStrictCallSiteProofsForFile(
          store,
          repo,
          service,
          projectId,
          result,
          workspaceIndex,
          functionNodeRefsByFile,
          fileIdMap,
          symbolIdMap,
          nodeKeyById,
          resolver,
          callerPolicy,
        ),
      );
    }
    return exclusions;
  }

  private persistStrictCallSiteProofsForFile(
    store: IGraphStore,
    repo: NonNullable<IGraphStore["callSiteResolutions"]>,
    service: ICallResolutionHypothesisService,
    projectId: number,
    result: ParsedAstFileResult,
    workspaceIndex: ReturnType<
      ICallResolutionHypothesisService["indexWorkspace"]
    >,
    functionNodeRefsByFile: Map<string, FunctionNodeReference[]>,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    nodeKeyById: ReadonlyMap<number, string>,
    resolver: ScopeResolver,
    callerPolicy: CallsProjectionCallerPolicy,
  ): StrictCallProofExclusion[] {
    const collection = collectStrictCallSiteProofs({
      service,
      workspaceIndex,
      result,
      functionNodes: functionNodeRefsByFile.get(result.file) ?? [],
      functionNodesByFile: functionNodeRefsByFile,
    });
    const sourceFileId = fileIdMap.get(result.file)!;
    const sourceSymbols = symbolIdMap.get(result.file);
    const functionNodes = functionNodeRefsByFile.get(result.file) ?? [];
    if (collection.proofs.length === 0) {
      this.persistCallerCandidatesForUnprojectedCalls(
        store,
        resolver,
        result,
        sourceFileId,
        sourceSymbols,
        fileIdMap,
        symbolIdMap,
        functionNodes,
        callerPolicy,
      );
      return [...collection.exclusions];
    }
    const proofs = collection.proofs;

    const projectionCallers = this.projectionCallersForProofs(
      result,
      proofs,
      sourceFileId,
      sourceSymbols,
      nodeKeyById,
      functionNodes,
      callerPolicy,
    );
    repo.replaceForFile(
      projectId,
      result.file,
      proofs.map(({ resolution }) => resolution),
      projectionCallers,
    );
    this.persistCallerCandidatesForProofs(
      store,
      result,
      proofs,
      sourceFileId,
      sourceSymbols,
      functionNodes,
      nodeKeyById,
      callerPolicy,
    );
    for (const proof of proofs) {
      repo.appendObservation(projectId, proof.strictObservation);
    }

    const provenKeys = new Set(proofs.map(({ callSiteKey }) => callSiteKey));
    this.restoreUnprovenCallsForCallerPolicy(
      store,
      resolver,
      result,
      sourceFileId,
      sourceSymbols,
      fileIdMap,
      symbolIdMap,
      provenKeys,
      functionNodes,
      callerPolicy,
    );
    return [...collection.exclusions];
  }

  private persistCallerCandidatesForUnprojectedCalls(
    store: IGraphStore,
    resolver: ScopeResolver,
    result: ParsedAstFileResult,
    sourceFileId: number,
    sourceSymbols: Map<string, number> | undefined,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    functionNodes: readonly FunctionNodeReference[],
    callerPolicy: CallsProjectionCallerPolicy,
  ): void {
    if (callerPolicy !== CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2)
      return;
    const candidateLinkKeys = new Set<string>();
    for (const call of result.data.calls ?? []) {
      const caller = this.resolveCallsProjectionCaller(
        callerPolicy,
        result,
        call,
        functionNodes,
        sourceSymbols,
        sourceFileId,
      );
      const candidateNodeId = this.callerContextCandidateNodeId(
        store,
        callerPolicy,
        call,
        functionNodes,
        sourceSymbols,
        sourceFileId,
        caller.nodeId,
      );
      if (candidateNodeId === undefined) continue;
      const resolved = this.resolveCallTarget(
        resolver,
        result.file,
        call.targetFunction,
        {
          calleeName: call.calleeName,
          receiverText: call.receiverText,
          calleeKind: call.calleeKind,
        },
      );
      if (!resolved) continue;
      const targetNodeId = this.resolveTargetNodeId(
        store,
        fileIdMap,
        symbolIdMap,
        resolved.targetFile,
        resolved.targetSymbol,
      );
      if (targetNodeId === undefined) continue;
      const hasProjectedCall = store.graph
        .getOutgoingRelations(caller.nodeId)
        .some(
          (relation) =>
            relation.id === targetNodeId &&
            relation.linkType === LinkTypes.CALLS,
        );
      if (!hasProjectedCall) continue;
      this.insertCallerCandidateLink(
        store,
        candidateNodeId,
        targetNodeId,
        candidateLinkKeys,
      );
    }
  }

  private restoreUnprovenCallsForCallerPolicy(
    store: IGraphStore,
    resolver: ScopeResolver,
    result: ParsedAstFileResult,
    sourceFileId: number | undefined,
    sourceSymbols: Map<string, number> | undefined,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    provenCallSiteKeys: ReadonlySet<string>,
    functionNodes: readonly FunctionNodeReference[],
    callerPolicy: CallsProjectionCallerPolicy,
  ): void {
    if (!sourceFileId) return;
    const callerCandidateLinkKeys = new Set<string>();
    for (const call of result.data.calls ?? []) {
      const callSiteKey = portableCallSiteKeyForCall(result, call);
      if (callSiteKey && provenCallSiteKeys.has(callSiteKey)) continue;

      const projectionCaller = this.resolveCallsProjectionCaller(
        callerPolicy,
        result,
        call,
        functionNodes,
        sourceSymbols,
        sourceFileId,
      );
      const callerCandidateNodeId = this.callerContextCandidateNodeId(
        store,
        callerPolicy,
        call,
        functionNodes,
        sourceSymbols,
        sourceFileId,
        projectionCaller.nodeId,
      );
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
        undefined,
        {
          calleeName: call.calleeName,
          receiverText: call.receiverText,
          calleeKind: call.calleeKind,
        },
        projectionCaller.nodeId,
        callerCandidateNodeId,
        callerCandidateLinkKeys,
      );
    }
  }

  private persistCallerCandidatesForProofs(
    store: IGraphStore,
    result: ParsedAstFileResult,
    proofs: readonly CallSiteProof[],
    sourceFileId: number,
    sourceSymbols: Map<string, number> | undefined,
    functionNodes: readonly FunctionNodeReference[],
    nodeKeyById: ReadonlyMap<number, string>,
    callerPolicy: CallsProjectionCallerPolicy,
  ): void {
    if (callerPolicy !== CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2)
      return;
    const callBySiteKey = new Map(
      (result.data.calls ?? []).flatMap((call) => {
        const callSiteKey = portableCallSiteKeyForCall(result, call);
        return callSiteKey ? [[callSiteKey, call] as const] : [];
      }),
    );
    const candidateLinkKeys = new Set<string>();
    for (const proof of proofs) {
      const call = callBySiteKey.get(proof.callSiteKey);
      if (!call || !proof.resolution.selectedTargetNodeKey) continue;
      const targetNodeId = store.graph.findNodeIdByNodeKey(
        proof.resolution.selectedTargetNodeKey,
      );
      if (targetNodeId === undefined) continue;
      const caller = this.resolveCallsProjectionCaller(
        callerPolicy,
        result,
        call,
        functionNodes,
        sourceSymbols,
        sourceFileId,
        nodeKeyById,
      );
      const hasProjectedCall = store.graph
        .getOutgoingRelations(caller.nodeId)
        .some(
          (relation) =>
            relation.id === targetNodeId &&
            relation.linkType === LinkTypes.CALLS,
        );
      if (!hasProjectedCall) continue;
      const candidateNodeId = this.callerContextCandidateNodeId(
        store,
        callerPolicy,
        call,
        functionNodes,
        sourceSymbols,
        sourceFileId,
        caller.nodeId,
      );
      if (candidateNodeId === undefined) continue;
      this.insertCallerCandidateLink(
        store,
        candidateNodeId,
        targetNodeId,
        candidateLinkKeys,
      );
    }
  }

  private canPersistStrictCallSiteProofs(
    store: IGraphStore,
    parsedResults: readonly ParsedAstFileResult[],
    sourceIndexComplete: boolean,
  ): boolean {
    return (
      store.callSiteResolutions !== undefined &&
      this.hypothesisService !== undefined &&
      sourceIndexComplete &&
      parsedResults.length > 0 &&
      parsedResults.every((result) =>
        isSha256(sourceContentHashForProof(result)),
      )
    );
  }

  private projectionCallersForProofs(
    result: ParsedAstFileResult,
    proofs: readonly CallSiteProof[],
    sourceFileId: number,
    sourceSymbols: Map<string, number> | undefined,
    nodeKeyById: ReadonlyMap<number, string>,
    functionNodes: readonly FunctionNodeReference[],
    callerPolicy: CallsProjectionCallerPolicy,
  ): CallSiteResolutionProjectionCallerInput[] {
    const callBySiteKey = new Map(
      (result.data.calls ?? []).flatMap((call) => {
        const callSiteKey = portableCallSiteKeyForCall(result, call);
        return callSiteKey ? [[callSiteKey, call] as const] : [];
      }),
    );
    return proofs.map(({ callSiteKey }) => {
      const call = callBySiteKey.get(callSiteKey);
      if (!call) {
        throw new DocuviaError(
          ErrorCodes.CALL_RESOLUTION_PROJECTION_SOURCE_MISSING,
          `Strict proof call site ${callSiteKey} has no parsed call`,
        );
      }
      const caller = this.resolveCallsProjectionCaller(
        callerPolicy,
        result,
        call,
        functionNodes,
        sourceSymbols,
        sourceFileId,
        nodeKeyById,
      );
      const callerNodeKey = caller.nodeKey ?? nodeKeyById.get(caller.nodeId);
      if (!callerNodeKey) {
        throw new DocuviaError(
          ErrorCodes.CALL_RESOLUTION_PROJECTION_SOURCE_MISSING,
          `Calls projection caller node ${caller.nodeId} has no portable key`,
        );
      }
      return { callSiteKey, callerNodeKey };
    });
  }

  private linkParsedResultRelations(
    store: IGraphStore,
    resolver: ScopeResolver,
    result: ParsedAstFileResult,
    sourceFileId: number,
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
    functionNodes: readonly FunctionNodeReference[],
    callerPolicy: CallsProjectionCallerPolicy,
    counters: CallResolutionCounters,
    persistCallerCandidates: boolean,
  ): void {
    const sourceSymbols = symbolIdMap.get(result.file);
    const callerCandidateLinkKeys = new Set<string>();

    for (const call of result.data.calls ?? []) {
      const projectionCaller = this.resolveCallsProjectionCaller(
        callerPolicy,
        result,
        call,
        functionNodes,
        sourceSymbols,
        sourceFileId,
      );
      const callerCandidateNodeId = persistCallerCandidates
        ? this.callerContextCandidateNodeId(
            store,
            callerPolicy,
            call,
            functionNodes,
            sourceSymbols,
            sourceFileId,
            projectionCaller.nodeId,
          )
        : undefined;
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
        projectionCaller.nodeId,
        callerCandidateNodeId,
        callerCandidateLinkKeys,
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

  /** Retains the legacy function attribution as impact context only when exact v2 has no
   *  persisted lexical-parent path to it. This does not change the `calls` source. */
  private callerContextCandidateNodeId(
    store: IGraphStore,
    callerPolicy: CallsProjectionCallerPolicy,
    call: NonNullable<ParsedAstFileResult["data"]["calls"]>[number],
    functionNodes: readonly FunctionNodeReference[],
    sourceSymbols: Map<string, number> | undefined,
    sourceFileId: number,
    exactCallerNodeId: number,
  ): number | undefined {
    if (callerPolicy !== CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2) {
      return undefined;
    }
    const candidateNodeId = this.resolveSourceNodeId(
      sourceSymbols,
      call.sourceFunction,
      sourceFileId,
    );
    if (
      candidateNodeId === exactCallerNodeId ||
      !functionNodes.some(
        ({ graphNodeId }) => graphNodeId === candidateNodeId,
      ) ||
      this.hasLexicalParentPath(store, exactCallerNodeId, candidateNodeId)
    ) {
      return undefined;
    }
    return candidateNodeId;
  }

  /** Follows only persisted `lexical_parent` links; file ownership and terminal owner links
   *  cannot establish an enclosing-function path. */
  private hasLexicalParentPath(
    store: IGraphStore,
    childNodeId: number,
    ancestorNodeId: number,
  ): boolean {
    const pending = [childNodeId];
    const visited = new Set<number>();
    while (pending.length > 0) {
      const currentNodeId = pending.pop();
      if (currentNodeId === undefined || visited.has(currentNodeId)) continue;
      if (currentNodeId === ancestorNodeId) return true;
      visited.add(currentNodeId);
      for (const relation of store.graph.getIncomingRelations(currentNodeId)) {
        if (relation.linkType === LinkTypes.LEXICAL_PARENT) {
          pending.push(relation.id);
        }
      }
    }
    return false;
  }

  private resolveCallsProjectionCaller(
    policy: CallsProjectionCallerPolicy,
    result: ParsedAstFileResult,
    call: NonNullable<ParsedAstFileResult["data"]["calls"]>[number],
    functionNodes: readonly FunctionNodeReference[],
    sourceSymbols: Map<string, number> | undefined,
    sourceFileId: number,
    nodeKeyById?: ReadonlyMap<number, string>,
  ): { readonly nodeId: number; readonly nodeKey?: string } {
    if (
      policy === CallsProjectionCallerPolicies.EXACT_ENCLOSING_V1 ||
      policy === CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2
    ) {
      const caller = exactCallerNodeForCall(result, call, functionNodes);
      return {
        nodeId: caller.graphNodeId ?? sourceFileId,
        nodeKey: caller.nodeKey,
      };
    }

    const nodeId = this.resolveSourceNodeId(
      sourceSymbols,
      call.sourceFunction,
      sourceFileId,
    );
    return { nodeId, nodeKey: nodeKeyById?.get(nodeId) };
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
    sourceNodeIdOverride?: number,
    callerCandidateNodeId?: number,
    callerCandidateLinkKeys?: Set<string>,
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
      sourceNodeIdOverride,
      callerCandidateNodeId,
      callerCandidateLinkKeys,
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
    sourceNodeIdOverride?: number,
    callerCandidateNodeId?: number,
    callerCandidateLinkKeys?: Set<string>,
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

    const sourceNodeId =
      sourceNodeIdOverride ??
      this.resolveSourceNodeId(sourceSymbols, sourceSymbolName, sourceFileId);

    // Self-call: the site resolved to the caller's own node -- structurally unresolvable into a
    // usable edge by design (persisted nowhere), so tracked separately from unresolved and
    // excluded from health-rate denominators.
    if (targetNodeId === sourceNodeId) return "self-discarded";

    store.graph.insertLink({ sourceNodeId, targetNodeId, linkType });
    if (
      linkType === LinkTypes.CALLS &&
      callerCandidateNodeId !== undefined &&
      callerCandidateNodeId !== targetNodeId
    ) {
      this.insertCallerCandidateLink(
        store,
        callerCandidateNodeId,
        targetNodeId,
        callerCandidateLinkKeys,
      );
    }
    return "linked";
  }

  private insertCallerCandidateLink(
    store: IGraphStore,
    candidateNodeId: number,
    targetNodeId: number,
    candidateLinkKeys?: Set<string>,
  ): void {
    // A legacy attribution can name the callee itself (for example when tied spans fall back to
    // the file caller). The call edge and call-site record carry the actual recursion evidence;
    // a caller_candidate self-edge is never useful context and must not be persisted.
    if (candidateNodeId === targetNodeId) return;

    const key = `${candidateNodeId}:${targetNodeId}`;
    if (candidateLinkKeys?.has(key)) return;
    const exists = store.graph
      .getIncomingRelations(targetNodeId)
      .some(
        (relation) =>
          relation.id === candidateNodeId &&
          relation.linkType === LinkTypes.CALLER_CANDIDATE,
      );
    if (!exists) {
      store.graph.insertLink({
        sourceNodeId: candidateNodeId,
        targetNodeId,
        linkType: LinkTypes.CALLER_CANDIDATE,
      });
    }
    candidateLinkKeys?.add(key);
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
