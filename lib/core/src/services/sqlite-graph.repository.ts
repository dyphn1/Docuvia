import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq, inArray } from "drizzle-orm";
import { ScopeResolver } from "./scope-resolver.js";
import { ReadWriteLock } from "../utils/read-write-lock.js";
import { ensureLocalFtsIndex, buildFtsMatchExpression } from "./sqlite-fts.js";
import {
  IGraphDatabaseRepository,
  ParsedAstFileResult,
} from "../interfaces/analyzer.interfaces.js";
import { AgenticSearchResult, LocalQueryIntent } from "../types/intent-router.types.js";
import {
  projectFilesTable,
  l1TagsTable,
  l2NodesTable,
  nodeLinksTable,
  l2NodeL1TagsTable,
} from "@workspace/db/schema/sqlite";

export class SqliteGraphRepository implements IGraphDatabaseRepository {
  /**
   * Per-database read/write lock queue (ADR-032). SQLite WAL mode permits concurrent
   * readers but only a single writer; serializing writes per DB file here prevents
   * SQLITE_BUSY ("database is locked") when parallel swarm agents persist concurrently.
   */
  private static readonly dbLocks = new Map<string, ReadWriteLock>();

  private static lockFor(dbPath: string): ReadWriteLock {
    let lock = SqliteGraphRepository.dbLocks.get(dbPath);
    if (!lock) {
      lock = new ReadWriteLock();
      SqliteGraphRepository.dbLocks.set(dbPath, lock);
    }
    return lock;
  }

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

    // Writes are queued through the exclusive lock so concurrent agents never
    // race the single WAL writer slot.
    return SqliteGraphRepository.lockFor(dbPath).runWrite(() =>
      this.persistAstGraphUnlocked(dbPath, workspaceRoot, parsedResults, tags)
    );
  }

  private async persistAstGraphUnlocked(
    dbPath: string,
    workspaceRoot: string,
    parsedResults: ParsedAstFileResult[],
    tags: string[]
  ): Promise<{ updatedCount: number; fileIdMap: Map<string, number> }> {
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
   * Local-first natural-language fallback (ADR-002 / ADR-029).
   *
   * Local vector search is deliberately NOT supported — vector similarity is a
   * server-only capability via pgvector (ADR-019). Instead, an LLM-extracted
   * structured intent (keywords + node references) is resolved against the
   * SQLite FTS5 index and the AST graph (node_links traversal).
   */
  public async searchLocalNodes(
    workspaceRoot: string,
    intent: LocalQueryIntent,
    limit = 10
  ): Promise<AgenticSearchResult[]> {
    const dbPath = path.join(workspaceRoot, ".docuvia", "local.db");
    if (!fs.existsSync(dbPath)) return [];

    // Shared read lock: FTS/graph queries may run alongside other readers, but
    // never while a swarm writer holds the exclusive lock (ADR-032).
    return SqliteGraphRepository.lockFor(dbPath).runRead(() =>
      this.searchLocalNodesUnlocked(dbPath, intent, limit)
    );
  }

  private searchLocalNodesUnlocked(
    dbPath: string,
    intent: LocalQueryIntent,
    limit: number
  ): AgenticSearchResult[] {
    const sqlite = new Database(dbPath);
    sqlite.pragma("busy_timeout = 10000");

    try {
      // Self-heal: databases created before the FTS5 rollout get their index
      // built (and backfilled) on first search.
      ensureLocalFtsIndex(sqlite);

      const merged = new Map<string, AgenticSearchResult>();
      const put = (result: AgenticSearchResult) => {
        const key = `${result.nodeLayer}:${result.id}`;
        const existing = merged.get(key);
        if (!existing || result.score > existing.score) merged.set(key, result);
      };
      const toIso = (value: unknown): string => {
        const date = new Date(String(value ?? ""));
        return isNaN(date.getTime()) ? String(value ?? "") : date.toISOString();
      };

      // 1) SQLite FTS5 keyword search over L2 (AST symbols/modules) and L3 (decisions)
      const matchExpr = buildFtsMatchExpression(intent.keywords ?? []);
      if (matchExpr) {
        const l2Rows = sqlite
          .prepare(
            `SELECT n.id, n.name, n.description, n.project_id, n.created_at
             FROM l2_nodes_fts f
             JOIN l2_nodes n ON n.id = f.rowid
             WHERE l2_nodes_fts MATCH ?
             ORDER BY rank
             LIMIT ?`
          )
          .all(matchExpr, limit) as any[];
        l2Rows.forEach((row, i) =>
          put({
            source: "direct",
            nodeLayer: "l2",
            id: row.id,
            title: row.name,
            content: row.description ?? null,
            projectId: row.project_id ?? null,
            projectName: null,
            score: 0.9 - i * 0.01,
            createdAt: toIso(row.created_at),
          })
        );

        const hasL3Fts = sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'l3_nodes_fts'")
          .get();
        if (hasL3Fts) {
          const l3Rows = sqlite
            .prepare(
              `SELECT n.id, n.title, n.content, n.created_at
               FROM l3_nodes_fts f
               JOIN l3_nodes n ON n.id = f.rowid
               WHERE l3_nodes_fts MATCH ?
               ORDER BY rank
               LIMIT ?`
            )
            .all(matchExpr, limit) as any[];
          l3Rows.forEach((row, i) =>
            put({
              source: "direct",
              nodeLayer: "l3",
              id: row.id,
              title: row.title,
              content: row.content ?? null,
              projectId: null,
              projectName: null,
              score: 0.85 - i * 0.01,
              createdAt: toIso(row.created_at),
            })
          );
        }
      }

      // 2) AST graph traversal for explicit node references
      const selectByName = sqlite.prepare(
        "SELECT id, name, description, project_id, created_at FROM l2_nodes WHERE name = ? LIMIT 1"
      );
      const selectByLike = sqlite.prepare(
        "SELECT id, name, description, project_id, created_at FROM l2_nodes WHERE name LIKE ? ESCAPE '\\' LIMIT 1"
      );
      const selectNeighbors = sqlite.prepare(
        `SELECT n.id, n.name, n.description, n.project_id, n.created_at, l.link_type
         FROM node_links l
         JOIN l2_nodes n ON n.id = l.target_node_id
         WHERE l.source_node_id = ?
         UNION
         SELECT n.id, n.name, n.description, n.project_id, n.created_at, l.link_type
         FROM node_links l
         JOIN l2_nodes n ON n.id = l.source_node_id
         WHERE l.target_node_id = ?
         LIMIT ?`
      );

      for (const ref of intent.nodeRefs ?? []) {
        const trimmedRef = ref.trim();
        if (!trimmedRef) continue;

        const escapedRef = trimmedRef.replace(/[\\%_]/g, (m) => `\\${m}`);
        const target = (selectByName.get(trimmedRef) ?? selectByLike.get(`%${escapedRef}%`)) as any;
        if (!target) continue;

        put({
          source: "graph",
          nodeLayer: "l2",
          id: target.id,
          title: target.name,
          content: target.description ?? null,
          projectId: target.project_id ?? null,
          projectName: null,
          score: 0.95,
          createdAt: toIso(target.created_at),
        });

        const neighbors = selectNeighbors.all(target.id, target.id, limit) as any[];
        neighbors.forEach((row, i) =>
          put({
            source: "graph",
            nodeLayer: "l2",
            id: row.id,
            title: row.name,
            content: row.description ?? `Linked to ${target.name} via ${row.link_type}`,
            projectId: row.project_id ?? null,
            projectName: null,
            score: 0.7 - i * 0.01,
            createdAt: toIso(row.created_at),
          })
        );
      }

      return Array.from(merged.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } finally {
      sqlite.close();
    }
  }
}
