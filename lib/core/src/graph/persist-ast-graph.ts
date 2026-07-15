import {
  type IGraphPersister,
  type IGraphStore,
  type ParsedAstFileResult,
  L2NodeTypes,
  LinkTypes,
} from "@workspace/contracts";
import { ScopeResolver } from "./scope-resolver.js";
import { ANONYMOUS_SYMBOL_NAME } from "../constants/symbols.js";

/**
 * Redistributes old `SqliteGraphRepository.persistAstGraph()`'s logic onto `IGraphStore`'s
 * named repo primitives.
 *
 * KNOWN DEVIATION FROM OLD BEHAVIOR: old `persistAstGraphUnlocked` ran this whole block inside
 * a single `drizzle` `db.transaction()`, giving it all-or-nothing atomicity on top of the
 * write-lock's serialization. `IGraphStore`'s public surface deliberately exposes no generic
 * raw-SQL/transaction escape hatch (only named repo methods, per the Virtual Contracts
 * "mandatory mapping" rule), so this only gets the write-lock's serialization guarantee (no
 * concurrent writer interleaving), not full transactional atomicity (a mid-loop throw can
 * leave a partially-persisted file) — a scoped, documented gap rather than a regression against
 * anything actually tested. Revisit if `IGraphStore` grows a `withTransaction()` primitive.
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

    return store.withWriteLock(() => {
      const resolver = new ScopeResolver(workspaceRoot);
      for (const result of parsedResults) {
        const locals: string[] = [];
        if (result.data.functions)
          locals.push(...result.data.functions.map((f) => f.name));
        if (result.data.classes)
          locals.push(...result.data.classes.map((c) => c.name));
        resolver.registerFile(
          result.file,
          result.data.imports || [],
          [],
          locals,
        );
      }

      const fileIdMap = new Map<string, number>();
      // Per-file map of symbol name -> l2_nodes.id, so calls/implements/extends can link to the
      // actual function/class node instead of collapsing to a file-to-file edge.
      const symbolIdMap = new Map<string, Map<string, number>>();
      let updatedCount = 0;

      for (const tag of tags) {
        store.tags.upsertTag(tag);
      }

      for (const result of parsedResults) {
        // Delete any stale nodes (and their outgoing links/tag-links) for this path so a
        // re-parsed file's old graph state doesn't linger.
        store.graph.deleteNodesForPath(result.file);

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

        for (const tag of tags) {
          const tagId = store.tags.getIdByName(tag);
          if (tagId !== undefined) store.tags.linkNodeToTag(fileId, tagId);
        }

        // Two symbols in the same file can share a name (multiple truly-anonymous callbacks all
        // named "anonymous" by resolveCallableName(), overloaded functions, same-named methods on
        // different classes, chained/nested callbacks sharing a start line, ...). node_key is
        // `${file}#${name}` and UNIQUE(project_id, node_key), so a second insert under an
        // already-used key would throw. Disambiguate only on actual collision, preferring the
        // symbol's start line (readable, usually enough) and falling back to a counter for the
        // rare case where even that repeats (e.g. `x.map(() => {}).filter(() => {})` on one line) —
        // guaranteed unique, so the common non-colliding case keeps its plain `file#name` key.
        const usedNodeKeys = new Set<string>([result.file]);
        const uniqueNodeKey = (baseKey: string, startLine: number): string => {
          if (!usedNodeKeys.has(baseKey)) return baseKey;
          const lineKey = `${baseKey}@L${startLine}`;
          if (!usedNodeKeys.has(lineKey)) return lineKey;
          let n = 2;
          while (usedNodeKeys.has(`${lineKey}#${n}`)) n++;
          return `${lineKey}#${n}`;
        };

        for (const fn of result.data.functions ?? []) {
          const nodeKey = uniqueNodeKey(
            `${result.file}#${fn.name}`,
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

        for (const cls of result.data.classes ?? []) {
          const nodeKey = uniqueNodeKey(
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

      // Resolves a symbol or file node id by name within a given file's path pattern. Falls back
      // to a DB lookup (beyond symbolIdMap/fileIdMap) so incremental runs can still link against
      // nodes persisted by a previous, unrelated batch.
      const findNodeIdByName = (
        filePath: string,
        name: string,
      ): number | undefined => store.graph.findNodeIdByName(filePath, name);

      for (const result of parsedResults) {
        const sourceFileId = fileIdMap.get(result.file);
        if (!sourceFileId) continue;

        const sourceSymbols = symbolIdMap.get(result.file);

        const processLink = (
          sourceSymbolName: string | undefined,
          targetFunctionOrClass: string,
          linkType: string,
        ) => {
          const resolved = resolver.resolveCall(
            result.file,
            targetFunctionOrClass,
          );
          if (!resolved) return;

          // Prefer the specific target function/class node; fall back to the file node when the
          // target isn't a tracked symbol (e.g. a re-exported value or namespace import).
          const targetNodeId =
            symbolIdMap.get(resolved.targetFile)?.get(resolved.targetSymbol) ??
            findNodeIdByName(resolved.targetFile, resolved.targetSymbol) ??
            fileIdMap.get(resolved.targetFile) ??
            findNodeIdByName(resolved.targetFile, resolved.targetFile);

          // Prefer the specific calling function/class node; fall back to the file node for
          // module-level (top-level) call sites.
          const sourceNodeId =
            (sourceSymbolName && sourceSymbolName !== ANONYMOUS_SYMBOL_NAME
              ? sourceSymbols?.get(sourceSymbolName)
              : undefined) ?? sourceFileId;

          if (targetNodeId && targetNodeId !== sourceNodeId) {
            store.graph.insertLink({ sourceNodeId, targetNodeId, linkType });
          }
        };

        for (const call of result.data.calls ?? []) {
          processLink(
            call.sourceFunction,
            call.targetFunction,
            LinkTypes.CALLS,
          );
        }
        for (const impl of result.data.implements ?? []) {
          processLink(
            impl.sourceClass,
            impl.targetInterface,
            LinkTypes.IMPLEMENTS,
          );
        }
        for (const ext of result.data.extends ?? []) {
          processLink(ext.sourceClass, ext.targetClass, LinkTypes.EXTENDS);
        }

        store.files.upsertFile({
          projectId,
          filePath: result.file,
          contentHash: result.hash,
        });
        updatedCount++;
      }

      return { updatedCount };
    });
  }
}
