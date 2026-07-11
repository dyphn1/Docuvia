import {
  AstParseFailure,
  DiscoveredFile,
  IAstProcessor,
  ParsedAstFileResult,
} from "../../interfaces/analyzer.interfaces.js";
import type { GraphStore } from "../../memory/graph-store.js";
import { ScopeResolver } from "../scope-resolver.js";
import { detectLanguageForFile } from "../../utils/language-detection.js";
import { appendInitLogLine } from "../init-log-writer.js";

export interface RunParseAndPersistResult {
  parsedResults: ParsedAstFileResult[];
  failures: AstParseFailure[];
  /** The final merged tag set (config + hotspot + per-file language tags), for the caller to
   *  fold into the result/summary. */
  tags: Set<string>;
}

/**
 * Phase 4 of `InitCommand.execute()`: ported from old `InitService.init()`'s step 4's second
 * half (`astProcessor.processFiles()`, per-file language-tag merge, per-file failure/oversized
 * logging) and step 4's persistence call — this function IS the replacement for old
 * `SqliteGraphRepository.persistAstGraph()`, redistributed onto `GraphStore.graph`/`.tags`/
 * `.files`'s primitives instead of `SqliteGraphRepository` opening its own connection.
 */
export async function runParseAndPersist(deps: {
  astProcessor: IAstProcessor;
  store: GraphStore;
  workspaceRoot: string;
  projectId: number;
  filesToParse: DiscoveredFile[];
  skippedOversized: { file: string; sizeBytes: number }[];
  /** Config + hotspot tags from `runDiscoveryPipeline`; mutated in place with per-file
   *  language tags detected from the parse results, matching old `InitService`'s single
   *  shared `tags` Set threaded through both phases. */
  tags: Set<string>;
  onProgress?: (msg: string) => void;
}): Promise<RunParseAndPersistResult> {
  const { astProcessor, store, workspaceRoot, projectId, filesToParse, skippedOversized, tags, onProgress } =
    deps;

  onProgress?.(`Parsing ${filesToParse.length} files...`);
  const { parsed: parsedResults, failures } = await astProcessor.processFiles(
    workspaceRoot,
    filesToParse
  );

  for (const result of parsedResults) {
    const language = detectLanguageForFile(result.file);
    if (language) tags.add(language);
  }

  for (const failure of failures) {
    await appendInitLogLine(workspaceRoot, { event: "init.parse_failure", ...failure });
  }
  for (const skipped of skippedOversized) {
    await appendInitLogLine(workspaceRoot, { event: "init.file_skipped_oversized", ...skipped });
  }

  onProgress?.("Persisting knowledge graph...");
  await persistAstGraph(store, workspaceRoot, projectId, parsedResults, Array.from(tags));

  return { parsedResults, failures, tags };
}

/**
 * Redistributes old `SqliteGraphRepository.persistAstGraphUnlocked()`'s logic onto
 * `GraphStore.graph`/`.tags`/`.files`'s named primitives. Serialized via `store.withWriteLock`
 * (replaces the old per-dbPath `static Map<string, ReadWriteLock>` — now unnecessary since
 * there's only ever one `GraphStore`/lock per `dbPath` per process).
 *
 * KNOWN DEVIATION FROM OLD BEHAVIOR: old `persistAstGraphUnlocked` ran this whole block inside
 * a single `drizzle` `db.transaction()`, giving it all-or-nothing atomicity on top of the
 * write-lock's serialization. `GraphStore`'s public surface deliberately exposes no generic
 * raw-SQL/transaction escape hatch (only named repo methods, per the plan's "memory/state
 * layer" section), so this function only gets the write-lock's serialization guarantee (no
 * concurrent writer interleaving), not full transactional atomicity (a mid-loop throw can
 * leave a partially-persisted file). Old `init-service.unit.test.ts`'s behavioral contract
 * doesn't exercise a mid-persist-failure scenario, so this is a scoped, documented gap rather
 * than a regression against anything actually tested — revisit if `GraphStore` grows a
 * `withTransaction()` primitive in a later milestone.
 */
async function persistAstGraph(
  store: GraphStore,
  workspaceRoot: string,
  projectId: number,
  parsedResults: ParsedAstFileResult[],
  tags: string[]
): Promise<{ updatedCount: number; fileIdMap: Map<string, number> }> {
  return store.withWriteLock(() => {
    const resolver = new ScopeResolver(workspaceRoot);
    for (const result of parsedResults) {
      const locals: string[] = [];
      if (result.data.functions) locals.push(...result.data.functions.map((f) => f.name));
      if (result.data.classes) locals.push(...result.data.classes.map((c) => c.name));
      resolver.registerFile(result.file, result.data.imports || [], [], locals);
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
        type: "module",
        description: "",
        pathPatterns: [result.file],
      });
      fileIdMap.set(result.file, fileId);
      const symbolsForFile = new Map<string, number>();
      symbolIdMap.set(result.file, symbolsForFile);

      for (const tag of tags) {
        const tagId = store.tags.getIdByName(tag);
        if (tagId !== undefined) store.tags.linkNodeToTag(fileId, tagId);
      }

      for (const fn of result.data.functions ?? []) {
        const fnId = store.graph.insertNode({
          projectId,
          name: fn.name,
          type: "module",
          description: "",
          pathPatterns: [result.file],
        });
        symbolsForFile.set(fn.name, fnId);
        store.graph.insertLink({ sourceNodeId: fileId, targetNodeId: fnId, linkType: "contains" });
      }

      for (const cls of result.data.classes ?? []) {
        const clsId = store.graph.insertNode({
          projectId,
          name: cls.name,
          type: "module",
          description: "",
          pathPatterns: [result.file],
        });
        symbolsForFile.set(cls.name, clsId);
        store.graph.insertLink({ sourceNodeId: fileId, targetNodeId: clsId, linkType: "contains" });
      }
    }

    // Resolves a symbol or file node id by name within a given file's path pattern. Falls back
    // to a DB lookup (beyond symbolIdMap/fileIdMap) so incremental runs can still link against
    // nodes persisted by a previous, unrelated batch.
    const findNodeIdByName = (filePath: string, name: string): number | undefined =>
      store.graph.findNodeIdByName(filePath, name);

    for (const result of parsedResults) {
      const sourceFileId = fileIdMap.get(result.file);
      if (!sourceFileId) continue;

      const sourceSymbols = symbolIdMap.get(result.file);

      const processLink = (
        sourceSymbolName: string | undefined,
        targetFunctionOrClass: string,
        linkType: string
      ) => {
        const resolved = resolver.resolveCall(result.file, targetFunctionOrClass);
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
          (sourceSymbolName && sourceSymbolName !== "anonymous"
            ? sourceSymbols?.get(sourceSymbolName)
            : undefined) ?? sourceFileId;

        if (targetNodeId && targetNodeId !== sourceNodeId) {
          store.graph.insertLink({ sourceNodeId, targetNodeId, linkType });
        }
      };

      for (const call of result.data.calls ?? []) {
        processLink(call.sourceFunction, call.targetFunction, "calls");
      }
      for (const impl of result.data.implements ?? []) {
        processLink(impl.sourceClass, impl.targetInterface, "implements");
      }
      for (const ext of result.data.extends ?? []) {
        processLink(ext.sourceClass, ext.targetClass, "extends");
      }

      store.files.upsertFile({ projectId, filePath: result.file, contentHash: result.hash });
      updatedCount++;
    }

    return { updatedCount, fileIdMap };
  });
}
