import type Database from "better-sqlite3";
import {
  DocuviaError,
  ErrorCodes,
  type IGraphNodesRepo,
  type L2NodeRow,
  type L2NodeWithL3Children,
  type L3NodeRow,
  type NodeLinkRow,
  L2NodeTypes,
} from "@workspace/contracts";
import { SchemaTables, SchemaColumns } from "../constants.js";

const GRAPH_REPO_ERROR_MESSAGES = {
  COUNT_FAILED: "Failed to count l2/l3 nodes",
  SEMANTIC_COVERAGE_FAILED: "Failed to compute L2 semantic coverage",
  FIND_NODES_FOR_CHANGED_FILES_FAILED: "Failed to find nodes for changed files",
  FIND_NODE_BY_NAME_FAILED: (target: string) =>
    `Failed to find node by name: ${target}`,
  INCOMING_EDGES_FAILED: (nodeId: number) =>
    `Failed to get incoming edges for node ${nodeId}`,
  OUTGOING_EDGES_FAILED: (nodeId: number) =>
    `Failed to get outgoing edges for node ${nodeId}`,
  ALL_NODES_FAILED: "Failed to get all l2 nodes",
  ALL_LINKS_FAILED: "Failed to get all node links",
  BULK_LOAD_FAILED: "Failed to bulk-load graph",
  PRUNE_ORPHANED_LINKS_FAILED: "Failed to prune orphaned node_links",
  FIND_NODE_BY_NODE_KEY_FAILED: (nodeKey: string) =>
    `Failed to find node by node_key: ${nodeKey}`,
  INCOMING_RELATIONS_FAILED: (nodeId: number) =>
    `Failed to get incoming relations for node ${nodeId}`,
  OUTGOING_RELATIONS_FAILED: (nodeId: number) =>
    `Failed to get outgoing relations for node ${nodeId}`,
} as const;

interface FindNodeByNameRow {
  id: number;
  name: string;
  type: string;
  path_patterns: string | null;
}

/** First `path_patterns` entry, JSON-parsed the same way `topology-builder.service.ts`'s
 *  `parseFilePath` does — used only by `findNodeByName`'s `filePath` field (`query`'s one
 *  consumer of it). */
function mapFindNodeByNameRow(row: FindNodeByNameRow): {
  id: number;
  name: string;
  type: string;
  filePath?: string;
} {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    filePath: parseFirstPathPattern(row.path_patterns),
  };
}

function parseFirstPathPattern(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return String(parsed[0]);
  } catch {
    // Malformed path_patterns JSON — treated the same as "no path" rather than throwing.
  }
  return undefined;
}

/** FTS5 sync-trigger names on `l2_nodes_fts` (see `migrations/0001_init.sql`) — dropped/recreated around `bulkLoadGraph`'s bulk insert. */
const SchemaTriggers = {
  L2_NODES_FTS_AFTER_INSERT: "l2_nodes_fts_ai",
  L2_NODES_FTS_AFTER_DELETE: "l2_nodes_fts_ad",
  L2_NODES_FTS_AFTER_UPDATE: "l2_nodes_fts_au",
} as const;

/**
 * Fallback node_key (STOR-005) for callers that don't pass one explicitly: `<path>` when `name`
 * already IS the path (a file node, matching `persist-ast-graph.ts`'s convention), else
 * `<path>#<name>` (a symbol node). Falls back to bare `name` if `pathPatterns` is empty.
 */
function deriveNodeKey(pathPatterns: string[], name: string): string {
  const path = pathPatterns[0];
  if (!path) return name;
  return path === name ? path : `${path}#${name}`;
}

/**
 * `graph` repo — `l2_nodes` / `node_links` persistence. Path-pattern matching convention: a
 * node's `path_patterns` column stores a single-element JSON array `["<file path>"]`.
 */
export class GraphNodesRepo implements IGraphNodesRepo {
  constructor(private readonly db: Database.Database) {}

  /**
   * Deletes any existing l2_nodes for `filePath` (and their outgoing node_links /
   * l2_node_l1_tags rows), so a re-parsed file's stale nodes don't linger. Returns the deleted
   * node ids.
   */
  deleteNodesForPath(filePath: string): number[] {
    const pattern = JSON.stringify([filePath]);
    const rows = this.db
      .prepare(
        `SELECT id FROM ${SchemaTables.L2_NODES} WHERE ${SchemaColumns.PATH_PATTERNS} = ?`,
      )
      .all(pattern) as { id: number }[];
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return ids;

    const placeholders = ids.map(() => "?").join(",");
    this.db
      .prepare(
        `DELETE FROM ${SchemaTables.L2_NODE_L1_TAGS} WHERE ${SchemaColumns.L2_NODE_ID} IN (${placeholders})`,
      )
      .run(...ids);
    this.db
      .prepare(
        `DELETE FROM ${SchemaTables.NODE_LINKS} WHERE ${SchemaColumns.SOURCE_NODE_ID} IN (${placeholders})`,
      )
      .run(...ids);
    this.db
      .prepare(
        `DELETE FROM ${SchemaTables.L2_NODES} WHERE id IN (${placeholders})`,
      )
      .run(...ids);
    return ids;
  }

  /**
   * Inserts an l2_node (file/function/class) and returns its new id. `nodeKey` is the
   * deterministic export identity (STOR-005); `id` remains an internal SQLite rowid used only for
   * in-database joins (`node_links`, `l3_nodes.l2_node_id`, ...), never for the git-exported
   * JSONL, which must key off `node_key` instead.
   */
  insertNode(input: {
    projectId: number;
    name: string;
    type?: string;
    description?: string;
    pathPatterns: string[];
    nodeKey?: string;
    contentHash?: string;
  }): number {
    const nodeKey =
      input.nodeKey ?? deriveNodeKey(input.pathPatterns, input.name);
    const result = this.db
      .prepare(
        `INSERT INTO ${SchemaTables.L2_NODES} (${SchemaColumns.PROJECT_ID}, name, type, description, ${SchemaColumns.PATH_PATTERNS}, ${SchemaColumns.NODE_KEY}, ${SchemaColumns.CONTENT_HASH})
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.projectId,
        input.name,
        input.type ?? L2NodeTypes.MODULE,
        input.description ?? "",
        JSON.stringify(input.pathPatterns),
        nodeKey,
        input.contentHash ?? null,
      );
    return Number(result.lastInsertRowid);
  }

  /** Inserts a node_links edge between two l2_nodes. */
  insertLink(input: {
    sourceNodeId: number;
    targetNodeId: number;
    linkType: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO ${SchemaTables.NODE_LINKS} (${SchemaColumns.SOURCE_NODE_ID}, ${SchemaColumns.TARGET_NODE_ID}, ${SchemaColumns.LINK_TYPE}) VALUES (?, ?, ?)`,
      )
      .run(input.sourceNodeId, input.targetNodeId, input.linkType);
  }

  /** Resolves an l2_node's id by (file path, symbol/file name), or undefined if not found. */
  findNodeIdByName(filePath: string, name: string): number | undefined {
    const pattern = JSON.stringify([filePath]);
    const row = this.db
      .prepare(
        `SELECT id FROM ${SchemaTables.L2_NODES} WHERE ${SchemaColumns.PATH_PATTERNS} = ? AND name = ?`,
      )
      .get(pattern, name) as { id: number } | undefined;
    return row?.id;
  }

  /** Row counts of `l2_nodes`/`l3_nodes` — used by `status`. */
  count(): { l2Nodes: number; l3Nodes: number } {
    try {
      const l2Nodes = (
        this.db
          .prepare(`SELECT COUNT(*) as c FROM ${SchemaTables.L2_NODES}`)
          .get() as {
          c: number;
        }
      ).c;
      const l3Nodes = (
        this.db
          .prepare(`SELECT COUNT(*) as c FROM ${SchemaTables.L3_NODES}`)
          .get() as {
          c: number;
        }
      ).c;
      return { l2Nodes, l3Nodes };
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.COUNT_FAILED,
        err,
      );
    }
  }

  /**
   * Issue #135: L2 semantic coverage — `SUM(CASE WHEN description ...)` over `l2_nodes`, the
   * same cheap-aggregate shape as `IProjectFilesRepo.getTierBCoverage` (no row materialization).
   * `SUM` returns `NULL` (not `0`) over an empty table, so `describedNodes` falls back to `0`.
   */
  getSemanticCoverage(): { totalNodes: number; describedNodes: number } {
    try {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) as total, SUM(CASE WHEN description IS NOT NULL AND description != '' THEN 1 ELSE 0 END) as described FROM ${SchemaTables.L2_NODES}`,
        )
        .get() as { total: number; described: number | null };
      return { totalNodes: row.total, describedNodes: row.described ?? 0 };
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.SEMANTIC_COVERAGE_FAILED,
        err,
      );
    }
  }

  /**
   * l2_nodes whose `path_patterns` intersects `changedFiles`, each paired with its l3_nodes —
   * used by `sync` (mirrors old Docuvia's `SyncService.readLocalCandidates`).
   */
  findNodesForChangedFiles(changedFiles: string[]): L2NodeWithL3Children[] {
    try {
      const changedSet = new Set(changedFiles);
      const allNodes = this.db
        .prepare(`SELECT * FROM ${SchemaTables.L2_NODES}`)
        .all() as L2NodeRow[];

      const candidates = allNodes.filter((node) => {
        if (!node.path_patterns) return false;
        try {
          const patterns: string[] = JSON.parse(node.path_patterns);
          return patterns.some((p) => changedSet.has(p));
        } catch {
          return false;
        }
      });

      const l3Stmt = this.db.prepare(
        `SELECT * FROM ${SchemaTables.L3_NODES} WHERE ${SchemaColumns.L2_NODE_ID} = ?`,
      );
      return candidates.map((l2Node) => ({
        l2Node,
        l3Nodes: l3Stmt.all(l2Node.id) as L3NodeRow[],
      }));
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.FIND_NODES_FOR_CHANGED_FILES_FAILED,
        err,
      );
    }
  }

  /**
   * Resolves a node by name: exact match first, falling back to a `LIKE %target%` match
   * (mirrors old Docuvia's `QueryService.findNodeByName`).
   *
   * Tie-break order among same-named candidates: non-test/spec path, then most-connected.
   * A path-depth tiebreaker (prefer the shallower file) was tried here as a workaround for the
   * vscode benchmark's `Disposable` mis-resolution (docs/cli-test-analysis/typescript-cli-benchmark.md,
   * Open Findings §1) and then reverted: that finding's real cause was `ScopeResolver` never
   * resolving relative imports whose specifier names a compiled `.js` extension (fixed in
   * `scope-resolver.ts`), which silently misattributed most `extends`/`implements` edges via
   * persist-ast-graph.ts's name-based fallback. Once that root cause was fixed, live-verified
   * against a real vscode ingestion, connectivity alone resolved `Disposable` correctly (2,316
   * incoming edges for the canonical `src/vs/base/common/lifecycle.ts` vs. 63 for the
   * next-most-connected same-named file) — a depth tiebreaker ahead of connectivity would have
   * picked the shallower-but-far-less-connected file instead, actively wrong once edges resolve
   * correctly.
   */
  findNodeByName(
    target: string,
  ): { id: number; name: string; type: string; filePath?: string } | undefined {
    try {
      const exact = this.db
        .prepare(
          `SELECT id, name, type, ${SchemaColumns.PATH_PATTERNS} FROM ${SchemaTables.L2_NODES} WHERE name = ? ORDER BY (${SchemaColumns.PATH_PATTERNS} LIKE '%test%' OR ${SchemaColumns.PATH_PATTERNS} LIKE '%spec%') ASC, (SELECT COUNT(*) FROM ${SchemaTables.NODE_LINKS} WHERE ${SchemaColumns.SOURCE_NODE_ID} = ${SchemaTables.L2_NODES}.id OR ${SchemaColumns.TARGET_NODE_ID} = ${SchemaTables.L2_NODES}.id) DESC LIMIT 1`,
        )
        .get(target) as FindNodeByNameRow | undefined;
      if (exact) return mapFindNodeByNameRow(exact);

      const escaped = target.replace(/[\\%_]/g, (m) => `\\${m}`);
      const like = this.db
        .prepare(
          `SELECT id, name, type, ${SchemaColumns.PATH_PATTERNS} FROM ${SchemaTables.L2_NODES} WHERE name LIKE ? ESCAPE '\\' ORDER BY (${SchemaColumns.PATH_PATTERNS} LIKE '%test%' OR ${SchemaColumns.PATH_PATTERNS} LIKE '%spec%') ASC, (SELECT COUNT(*) FROM ${SchemaTables.NODE_LINKS} WHERE ${SchemaColumns.SOURCE_NODE_ID} = ${SchemaTables.L2_NODES}.id OR ${SchemaColumns.TARGET_NODE_ID} = ${SchemaTables.L2_NODES}.id) DESC LIMIT 1`,
        )
        .get(`%${escaped}%`) as FindNodeByNameRow | undefined;
      return like ? mapFindNodeByNameRow(like) : undefined;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.FIND_NODE_BY_NAME_FAILED(target),
        err,
      );
    }
  }

  /**
   * Resolves an l2_node's id by its exact STOR-005 `node_key`. Used by `analyze <targetPath>`'s
   * decision-extraction anchor resolution.
   */
  findNodeIdByNodeKey(nodeKey: string): number | undefined {
    try {
      const row = this.db
        .prepare(
          `SELECT id FROM ${SchemaTables.L2_NODES} WHERE ${SchemaColumns.NODE_KEY} = ?`,
        )
        .get(nodeKey) as { id: number } | undefined;
      return row?.id;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.FIND_NODE_BY_NODE_KEY_FAILED(nodeKey),
        err,
      );
    }
  }

  /**
   * Nodes with an outgoing node_links edge INTO nodeId — the 1-hop "blast radius". `DISTINCT`
   * dedupes a neighbor that's connected by more than one edge type (e.g. both a `calls` and a
   * `depends_on` link between the same pair of nodes), so it isn't double-counted.
   */
  getIncomingEdges(
    nodeId: number,
  ): Array<{ id: number; name: string; type: string }> {
    try {
      return this.db
        .prepare(
          `SELECT DISTINCT n.id as id, n.name as name, n.type as type
           FROM ${SchemaTables.NODE_LINKS} l
           JOIN ${SchemaTables.L2_NODES} n ON n.id = l.${SchemaColumns.SOURCE_NODE_ID}
           WHERE l.${SchemaColumns.TARGET_NODE_ID} = ?`,
        )
        .all(nodeId) as Array<{ id: number; name: string; type: string }>;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.INCOMING_EDGES_FAILED(nodeId),
        err,
      );
    }
  }

  /** Nodes nodeId links out to. See `getIncomingEdges()`'s doc comment on the `DISTINCT`. */
  getOutgoingEdges(
    nodeId: number,
  ): Array<{ id: number; name: string; type: string }> {
    try {
      return this.db
        .prepare(
          `SELECT DISTINCT n.id as id, n.name as name, n.type as type
           FROM ${SchemaTables.NODE_LINKS} l
           JOIN ${SchemaTables.L2_NODES} n ON n.id = l.${SchemaColumns.TARGET_NODE_ID}
           WHERE l.${SchemaColumns.SOURCE_NODE_ID} = ?`,
        )
        .all(nodeId) as Array<{ id: number; name: string; type: string }>;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.OUTGOING_EDGES_FAILED(nodeId),
        err,
      );
    }
  }

  /** `query`'s incoming-relations lookup — see `IGraphNodesRepo.getIncomingRelations()`'s doc
   *  comment on how this differs from `getIncomingEdges()`. */
  getIncomingRelations(
    nodeId: number,
  ): Array<{ id: number; name: string; type: string; linkType: string }> {
    try {
      return this.db
        .prepare(
          `SELECT DISTINCT n.id as id, n.name as name, n.type as type, l.${SchemaColumns.LINK_TYPE} as linkType
           FROM ${SchemaTables.NODE_LINKS} l
           JOIN ${SchemaTables.L2_NODES} n ON n.id = l.${SchemaColumns.SOURCE_NODE_ID}
           WHERE l.${SchemaColumns.TARGET_NODE_ID} = ?`,
        )
        .all(nodeId) as Array<{
        id: number;
        name: string;
        type: string;
        linkType: string;
      }>;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.INCOMING_RELATIONS_FAILED(nodeId),
        err,
      );
    }
  }

  /** `query`'s outgoing-relations lookup. See `getIncomingRelations()`'s doc comment. */
  getOutgoingRelations(
    nodeId: number,
  ): Array<{ id: number; name: string; type: string; linkType: string }> {
    try {
      return this.db
        .prepare(
          `SELECT DISTINCT n.id as id, n.name as name, n.type as type, l.${SchemaColumns.LINK_TYPE} as linkType
           FROM ${SchemaTables.NODE_LINKS} l
           JOIN ${SchemaTables.L2_NODES} n ON n.id = l.${SchemaColumns.TARGET_NODE_ID}
           WHERE l.${SchemaColumns.SOURCE_NODE_ID} = ?`,
        )
        .all(nodeId) as Array<{
        id: number;
        name: string;
        type: string;
        linkType: string;
      }>;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.OUTGOING_RELATIONS_FAILED(nodeId),
        err,
      );
    }
  }

  /** Every l2_nodes row — used by `export-topology`. */
  getAllNodes(): L2NodeRow[] {
    try {
      return this.db
        .prepare(`SELECT * FROM ${SchemaTables.L2_NODES}`)
        .all() as L2NodeRow[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.ALL_NODES_FAILED,
        err,
      );
    }
  }

  /** Every node_links row — used by `export-topology`. */
  getAllLinks(): NodeLinkRow[] {
    try {
      return this.db
        .prepare(`SELECT * FROM ${SchemaTables.NODE_LINKS}`)
        .all() as NodeLinkRow[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.ALL_LINKS_FAILED,
        err,
      );
    }
  }

  /**
   * Drops `l2_nodes_fts`'s AFTER-INSERT/DELETE/UPDATE triggers, runs `fn`, then rebuilds the
   * FTS5 index in one pass and recreates the triggers — the same technique `bulkLoadGraph`
   * already uses internally (see its own doc comment), exposed here for callers that insert/
   * delete many `l2_nodes` rows one at a time across several repo calls instead of in one bulk
   * array (`persist-ast-graph.ts`'s `persistFileAndSymbolNodes`, called once per parsed file).
   * Per-row FTS5 tokenization is the dominant cost at 100k+ nodes; at vscode-repo scale
   * (293k+ nodes) leaving it on turned a `store.withTransaction()`-wrapped persist's WAL into
   * unboundedly large and eventually failing with SQLite's own "disk I/O error" (Windows-side
   * WAL/shm growth, not the transaction wrapping itself, which was independently verified
   * atomic) — see docs/cli-test-analysis/typescript-cli-benchmark.md's Tier B re-verification
   * session. Not itself a transaction: DROP/CREATE TRIGGER are DDL, so if `fn` throws inside a
   * caller's own `withTransaction()`, the whole transaction (including these DDL statements)
   * rolls back together and the original triggers come back intact — no separate try/finally
   * needed here.
   */
  withFtsSyncSuspended<T>(fn: () => T): T {
    this.db.exec(FTS_TRIGGER_DROP_SQL);
    const result = fn();
    this.db.exec(
      `INSERT INTO ${SchemaTables.L2_NODES_FTS}(${SchemaTables.L2_NODES_FTS}) VALUES('rebuild')`,
    );
    this.db.exec(FTS_TRIGGER_RECREATE_SQL);
    return result;
  }

  /**
   * Rebuild-not-upsert bulk load (STOR-002 hydration). Single `db.transaction()` wrapping
   * prepared-statement loops — no autocommit-per-row, no ORM — per STOR-002's performance
   * guardrails. `node_key` is the stable cross-machine identity (STOR-005); edges reference it
   * instead of a rowid, so a fresh rowid space each hydration is fine — it's assigned here and
   * never leaves this process.
   */
  bulkLoadGraph(input: {
    projectId: number;
    nodes: Array<{ nodeKey: string; name: string; filePath?: string }>;
    edges: Array<{ source: string; target: string; type: string }>;
  }): { nodesLoaded: number; edgesLoaded: number; edgesDropped: number } {
    try {
      const run = this.db.transaction(() => {
        // The l2_nodes_fts AFTER-INSERT trigger fires (and tokenizes) once per row, which is the
        // dominant cost at 100k+ nodes (STOR-002's <10s bar). Dropping the triggers for the
        // duration of the bulk load and resyncing the FTS5 index with a single 'rebuild' command
        // afterward does the same tokenization work in bulk instead of once per row.
        this.db.exec(FTS_TRIGGER_DROP_SQL);

        this.db.exec(`DELETE FROM ${SchemaTables.NODE_LINKS}`);
        this.db.exec(`DELETE FROM ${SchemaTables.L2_NODE_L1_TAGS}`);
        this.db.exec(`DELETE FROM ${SchemaTables.L2_NODES}`);

        const insertNode = this.db.prepare(
          `INSERT INTO ${SchemaTables.L2_NODES} (${SchemaColumns.PROJECT_ID}, name, type, description, ${SchemaColumns.PATH_PATTERNS}, ${SchemaColumns.NODE_KEY})
           VALUES (?, ?, ?, '', ?, ?)`,
        );
        const keyToId = new Map<string, number>();
        for (const node of input.nodes) {
          const result = insertNode.run(
            input.projectId,
            node.name,
            L2NodeTypes.MODULE,
            JSON.stringify(node.filePath ? [node.filePath] : []),
            node.nodeKey,
          );
          keyToId.set(node.nodeKey, Number(result.lastInsertRowid));
        }

        const insertLink = this.db.prepare(
          `INSERT INTO ${SchemaTables.NODE_LINKS} (${SchemaColumns.SOURCE_NODE_ID}, ${SchemaColumns.TARGET_NODE_ID}, ${SchemaColumns.LINK_TYPE}) VALUES (?, ?, ?)`,
        );
        let edgesLoaded = 0;
        let edgesDropped = 0;
        for (const edge of input.edges) {
          const sourceId = keyToId.get(edge.source);
          const targetId = keyToId.get(edge.target);
          if (sourceId === undefined || targetId === undefined) {
            edgesDropped++;
            continue;
          }
          insertLink.run(sourceId, targetId, edge.type);
          edgesLoaded++;
        }

        this.db.exec(
          `INSERT INTO ${SchemaTables.L2_NODES_FTS}(${SchemaTables.L2_NODES_FTS}) VALUES('rebuild')`,
        );
        this.db.exec(FTS_TRIGGER_RECREATE_SQL);

        return { nodesLoaded: input.nodes.length, edgesLoaded, edgesDropped };
      });
      return run();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.BULK_LOAD_FAILED,
        err,
      );
    }
  }

  /**
   * Deletes `node_links` rows whose source or target id no longer exists in `l2_nodes` — see the
   * `IGraphNodesRepo.pruneOrphanedLinks` doc comment for why these accumulate (Tier B batch
   * hygiene, PLAT-007/phase1-decision-integration.md §8d). `NOT IN` against a (typically small)
   * `l2_nodes.id` set is simplest and matches this table's expected scale; no index tuning done
   * beyond the existing primary keys.
   */
  pruneOrphanedLinks(): number {
    try {
      const result = this.db
        .prepare(
          `DELETE FROM ${SchemaTables.NODE_LINKS}
           WHERE ${SchemaColumns.SOURCE_NODE_ID} NOT IN (SELECT id FROM ${SchemaTables.L2_NODES})
              OR ${SchemaColumns.TARGET_NODE_ID} NOT IN (SELECT id FROM ${SchemaTables.L2_NODES})`,
        )
        .run();
      return result.changes;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        GRAPH_REPO_ERROR_MESSAGES.PRUNE_ORPHANED_LINKS_FAILED,
        err,
      );
    }
  }
}

const FTS_TRIGGER_DROP_SQL = `
  DROP TRIGGER IF EXISTS ${SchemaTriggers.L2_NODES_FTS_AFTER_INSERT};
  DROP TRIGGER IF EXISTS ${SchemaTriggers.L2_NODES_FTS_AFTER_DELETE};
  DROP TRIGGER IF EXISTS ${SchemaTriggers.L2_NODES_FTS_AFTER_UPDATE};
`;

/** Must stay textually identical to the trigger definitions in migrations/0001_init.sql — bulkLoadGraph() drops these for the duration of the load and recreates them here afterward. */
const FTS_TRIGGER_RECREATE_SQL = `
  CREATE TRIGGER IF NOT EXISTS ${SchemaTriggers.L2_NODES_FTS_AFTER_INSERT} AFTER INSERT ON ${SchemaTables.L2_NODES} BEGIN
    INSERT INTO ${SchemaTables.L2_NODES_FTS}(rowid, name, description, ${SchemaColumns.PATH_PATTERNS})
    VALUES (new.id, new.name, new.description, new.${SchemaColumns.PATH_PATTERNS});
  END;
  CREATE TRIGGER IF NOT EXISTS ${SchemaTriggers.L2_NODES_FTS_AFTER_DELETE} AFTER DELETE ON ${SchemaTables.L2_NODES} BEGIN
    INSERT INTO ${SchemaTables.L2_NODES_FTS}(${SchemaTables.L2_NODES_FTS}, rowid, name, description, ${SchemaColumns.PATH_PATTERNS})
    VALUES ('delete', old.id, old.name, old.description, old.${SchemaColumns.PATH_PATTERNS});
  END;
  CREATE TRIGGER IF NOT EXISTS ${SchemaTriggers.L2_NODES_FTS_AFTER_UPDATE} AFTER UPDATE ON ${SchemaTables.L2_NODES} BEGIN
    INSERT INTO ${SchemaTables.L2_NODES_FTS}(${SchemaTables.L2_NODES_FTS}, rowid, name, description, ${SchemaColumns.PATH_PATTERNS})
    VALUES ('delete', old.id, old.name, old.description, old.${SchemaColumns.PATH_PATTERNS});
    INSERT INTO ${SchemaTables.L2_NODES_FTS}(rowid, name, description, ${SchemaColumns.PATH_PATTERNS})
    VALUES (new.id, new.name, new.description, new.${SchemaColumns.PATH_PATTERNS});
  END;
`;
