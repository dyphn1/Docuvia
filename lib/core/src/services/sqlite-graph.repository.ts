import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq, inArray } from "drizzle-orm";
import { ScopeResolver } from "./scope-resolver.js";
import {
  IGraphDatabaseRepository,
  ParsedAstFileResult,
} from "../interfaces/analyzer.interfaces.js";
import {
  projectFilesTable,
  l1TagsTable,
  l2NodesTable,
  nodeLinksTable,
  l2NodeL1TagsTable,
} from "@workspace/db/schema/sqlite";

export class SqliteGraphRepository implements IGraphDatabaseRepository {
  public async persistAstGraph(
    workspaceRoot: string,
    parsedResults: ParsedAstFileResult[],
    tags: string[]
  ): Promise<{ updatedCount: number; fileIdMap: Map<string, number> }> {
    const docuviaDir = path.join(workspaceRoot, ".docuvia");
    if (!fs.existsSync(docuviaDir)) {
      fs.mkdirSync(docuviaDir, { recursive: true });
    }

    const dbPath = path.join(docuviaDir, "local.db");
    const sqlite = new Database(dbPath);

    // Apply PRAGMAs required for concurrent workers & WAL
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
    sqlite.pragma("busy_timeout = 10000");

    const db = drizzle(sqlite);
    const resolver = new ScopeResolver(workspaceRoot);

    try {
      for (const result of parsedResults) {
        const locals: string[] = [];
        if (result.data.functions) locals.push(...result.data.functions.map((f) => f.name));
        if (result.data.classes) locals.push(...result.data.classes.map((c) => c.name));
        resolver.registerFile(result.file, result.data.imports || [], [], locals);
      }

      // Using transaction for atomicity
      const { updatedCount, fileIdMap } = db.transaction((tx) => {
        let parsedCount = 0;
        const fileIdMap = new Map<string, number>();
        // Per-file map of symbol name -> l2_nodes.id, so calls/implements/extends can link to the
        // actual function/class node instead of collapsing to a file-to-file edge.
        const symbolIdMap = new Map<string, Map<string, number>>();

        // Insert L1 Tags
        for (const tag of tags) {
          tx.insert(l1TagsTable)
            .values({
              name: tag,
              slug: tag,
              description: `Auto-detected tag: ${tag}`,
            })
            .onConflictDoNothing()
            .run();
        }

        for (const result of parsedResults) {
          const sourcePathJson = [result.file];

          // We need to delete old links and nodes for this path.
          // First find l2_nodes matching pathPatterns
          const oldNodes = tx
            .select({ id: l2NodesTable.id })
            .from(l2NodesTable)
            .where(eq(l2NodesTable.pathPatterns, sourcePathJson))
            .all();

          const oldNodeIds = oldNodes.map((n) => n.id);
          if (oldNodeIds.length > 0) {
            tx.delete(l2NodeL1TagsTable)
              .where(inArray(l2NodeL1TagsTable.l2NodeId, oldNodeIds))
              .run();
            tx.delete(nodeLinksTable).where(inArray(nodeLinksTable.sourceNodeId, oldNodeIds)).run();
            tx.delete(l2NodesTable).where(inArray(l2NodesTable.id, oldNodeIds)).run();
          }

          // Insert new file node
          const nodeInsert = tx
            .insert(l2NodesTable)
            .values({
              projectId: 1,
              name: result.file,
              type: "module",
              description: "",
              pathPatterns: sourcePathJson,
            })
            .returning({ id: l2NodesTable.id })
            .get();

          if (!nodeInsert) {
            throw new Error(
              `[SqliteGraphRepository] Failed to insert or update L2 Node for file ${result.file}`
            );
          }
          const fileId = nodeInsert.id;
          fileIdMap.set(result.file, fileId);
          const symbolsForFile = new Map<string, number>();
          symbolIdMap.set(result.file, symbolsForFile);

          for (const tag of tags) {
            const l1TagRow = tx
              .select({ id: l1TagsTable.id })
              .from(l1TagsTable)
              .where(eq(l1TagsTable.name, tag))
              .get();
            if (l1TagRow) {
              tx.insert(l2NodeL1TagsTable)
                .values({
                  l2NodeId: fileId,
                  l1TagId: l1TagRow.id,
                })
                .run();
            }
          }

          if (result.data.functions) {
            for (const fn of result.data.functions) {
              const fnInsert = tx
                .insert(l2NodesTable)
                .values({
                  projectId: 1,
                  name: fn.name,
                  type: "module",
                  description: "",
                  pathPatterns: sourcePathJson,
                })
                .returning({ id: l2NodesTable.id })
                .get();
              if (fnInsert) {
                symbolsForFile.set(fn.name, fnInsert.id);
                tx.insert(nodeLinksTable)
                  .values({
                    sourceNodeId: fileId,
                    targetNodeId: fnInsert.id,
                    linkType: "contains",
                  })
                  .run();
              }
            }
          }

          if (result.data.classes) {
            for (const cls of result.data.classes) {
              const clsInsert = tx
                .insert(l2NodesTable)
                .values({
                  projectId: 1,
                  name: cls.name,
                  type: "module",
                  description: "",
                  pathPatterns: sourcePathJson,
                })
                .returning({ id: l2NodesTable.id })
                .get();
              if (clsInsert) {
                symbolsForFile.set(cls.name, clsInsert.id);
                tx.insert(nodeLinksTable)
                  .values({
                    sourceNodeId: fileId,
                    targetNodeId: clsInsert.id,
                    linkType: "contains",
                  })
                  .run();
              }
            }
          }
        }

        // Resolves a symbol or file node id by name within a given file's path pattern. Falls back
        // to a DB lookup (beyond symbolIdMap/fileIdMap) so incremental runs can still link against
        // nodes persisted by a previous, unrelated batch.
        const findNodeIdByName = (filePath: string, name: string): number | undefined => {
          const row = tx
            .select({ id: l2NodesTable.id })
            .from(l2NodesTable)
            .where(and(eq(l2NodesTable.pathPatterns, [filePath]), eq(l2NodesTable.name, name)))
            .get();
          return row?.id;
        };

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
            if (resolved) {
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
                tx.insert(nodeLinksTable)
                  .values({
                    sourceNodeId,
                    targetNodeId,
                    linkType,
                  })
                  .run();
              }
            }
          };

          if (result.data.calls) {
            for (const call of result.data.calls) {
              processLink(call.sourceFunction, call.targetFunction, "calls");
            }
          }

          if (result.data.implements) {
            for (const impl of result.data.implements) {
              processLink(impl.sourceClass, impl.targetInterface, "implements");
            }
          }

          if (result.data.extends) {
            for (const ext of result.data.extends) {
              processLink(ext.sourceClass, ext.targetClass, "extends");
            }
          }

          tx.insert(projectFilesTable)
            .values({
              projectId: 1,
              filePath: result.file,
              contentHash: result.hash,
            })
            .onConflictDoUpdate({
              target: [projectFilesTable.projectId, projectFilesTable.filePath],
              set: {
                contentHash: result.hash,
                lastParsedAt: "CURRENT_TIMESTAMP",
              },
            })
            .run();

          parsedCount++;
        }

        return { updatedCount: parsedCount, fileIdMap };
      });

      return { updatedCount, fileIdMap };
    } finally {
      sqlite.close();
    }
  }

  /**
   * Pending/Excluded Goal: Local vector search (Option 3).
   * Do not implement pgvector capabilities in SQLite local mode.
   */
  public async searchSimilarNodes(embedding: number[]): Promise<any[]> {
    throw new Error("NotImplementedError: Local vector search is deferred to a future phase.");
  }
}
