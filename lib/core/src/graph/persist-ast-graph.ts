import {
  type IGraphPersister,
  type IGraphStore,
  type ParsedAstFileResult,
  L2NodeTypes,
  LinkTypes,
} from "@workspace/contracts";
import { ScopeResolver } from "./scope-resolver.js";
import { ANONYMOUS_SYMBOL_NAME } from "../constants/symbols.js";
import { buildUniqueNodeKey, buildQualifiedBaseKey } from "./node-key.js";

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
  }): Promise<{ updatedCount: number }> {
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
  ): { updatedCount: number } {
    return store.withTransaction(() => {
      const resolver = new ScopeResolver(workspaceRoot);
      this.registerResolverFiles(resolver, parsedResults);

      const fileIdMap = new Map<string, number>();
      // Per-file map of symbol name -> l2_nodes.id, so calls/implements/extends can link to the
      // actual function/class node instead of collapsing to a file-to-file edge.
      const symbolIdMap = new Map<string, Map<string, number>>();

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
      );

      return { updatedCount };
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

  /** Links calls/implements/extends edges for every parsed result and upserts its file row.
   *  Returns the number of files processed (matches old `updatedCount` semantics). */
  private linkParsedResults(
    store: IGraphStore,
    resolver: ScopeResolver,
    projectId: number,
    parsedResults: ParsedAstFileResult[],
    fileIdMap: Map<string, number>,
    symbolIdMap: Map<string, Map<string, number>>,
  ): number {
    let updatedCount = 0;

    for (const result of parsedResults) {
      const sourceFileId = fileIdMap.get(result.file);
      if (!sourceFileId) continue;

      this.linkParsedResultRelations(
        store,
        resolver,
        result,
        sourceFileId,
        fileIdMap,
        symbolIdMap,
      );

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
  ): void {
    const resolved = resolver.resolveCall(sourceFile, targetFunctionOrClass);
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
    if (!targetNodeId) return;

    const sourceNodeId = this.resolveSourceNodeId(
      sourceSymbols,
      sourceSymbolName,
      sourceFileId,
    );

    if (targetNodeId !== sourceNodeId) {
      store.graph.insertLink({ sourceNodeId, targetNodeId, linkType });
    }
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
