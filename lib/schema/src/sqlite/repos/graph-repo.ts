import type Database from "better-sqlite3";
import {
  DocuviaError,
  ErrorCodes,
  type IGraphNodesRepo,
  type L2NodeRow,
  type L2NodeWithL3Children,
  type L3NodeRow,
  type NodeLinkRow,
} from "@workspace/contracts";

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
      .prepare("SELECT id FROM l2_nodes WHERE path_patterns = ?")
      .all(pattern) as { id: number }[];
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return ids;

    const placeholders = ids.map(() => "?").join(",");
    this.db
      .prepare(
        `DELETE FROM l2_node_l1_tags WHERE l2_node_id IN (${placeholders})`,
      )
      .run(...ids);
    this.db
      .prepare(
        `DELETE FROM node_links WHERE source_node_id IN (${placeholders})`,
      )
      .run(...ids);
    this.db
      .prepare(`DELETE FROM l2_nodes WHERE id IN (${placeholders})`)
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
        `INSERT INTO l2_nodes (project_id, name, type, description, path_patterns, node_key, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.projectId,
        input.name,
        input.type ?? "module",
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
        "INSERT INTO node_links (source_node_id, target_node_id, link_type) VALUES (?, ?, ?)",
      )
      .run(input.sourceNodeId, input.targetNodeId, input.linkType);
  }

  /** Resolves an l2_node's id by (file path, symbol/file name), or undefined if not found. */
  findNodeIdByName(filePath: string, name: string): number | undefined {
    const pattern = JSON.stringify([filePath]);
    const row = this.db
      .prepare("SELECT id FROM l2_nodes WHERE path_patterns = ? AND name = ?")
      .get(pattern, name) as { id: number } | undefined;
    return row?.id;
  }

  /** Row counts of `l2_nodes`/`l3_nodes` — used by `status`. */
  count(): { l2Nodes: number; l3Nodes: number } {
    try {
      const l2Nodes = (
        this.db.prepare("SELECT COUNT(*) as c FROM l2_nodes").get() as {
          c: number;
        }
      ).c;
      const l3Nodes = (
        this.db.prepare("SELECT COUNT(*) as c FROM l3_nodes").get() as {
          c: number;
        }
      ).c;
      return { l2Nodes, l3Nodes };
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        "Failed to count l2/l3 nodes",
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
        .prepare("SELECT * FROM l2_nodes")
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
        "SELECT * FROM l3_nodes WHERE l2_node_id = ?",
      );
      return candidates.map((l2Node) => ({
        l2Node,
        l3Nodes: l3Stmt.all(l2Node.id) as L3NodeRow[],
      }));
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        "Failed to find nodes for changed files",
        err,
      );
    }
  }

  /**
   * Resolves a node by name: exact match first, falling back to a `LIKE %target%` match
   * (mirrors old Docuvia's `QueryService.findNodeByName`).
   */
  findNodeByName(
    target: string,
  ): { id: number; name: string; type: string } | undefined {
    try {
      const exact = this.db
        .prepare("SELECT id, name, type FROM l2_nodes WHERE name = ? LIMIT 1")
        .get(target) as { id: number; name: string; type: string } | undefined;
      if (exact) return exact;

      const escaped = target.replace(/[\\%_]/g, (m) => `\\${m}`);
      return this.db
        .prepare(
          "SELECT id, name, type FROM l2_nodes WHERE name LIKE ? ESCAPE '\\' LIMIT 1",
        )
        .get(`%${escaped}%`) as
        { id: number; name: string; type: string } | undefined;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        `Failed to find node by name: ${target}`,
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
        .prepare("SELECT id FROM l2_nodes WHERE node_key = ?")
        .get(nodeKey) as { id: number } | undefined;
      return row?.id;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        `Failed to find node by node_key: ${nodeKey}`,
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
           FROM node_links l
           JOIN l2_nodes n ON n.id = l.source_node_id
           WHERE l.target_node_id = ?`,
        )
        .all(nodeId) as Array<{ id: number; name: string; type: string }>;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        `Failed to get incoming edges for node ${nodeId}`,
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
           FROM node_links l
           JOIN l2_nodes n ON n.id = l.target_node_id
           WHERE l.source_node_id = ?`,
        )
        .all(nodeId) as Array<{ id: number; name: string; type: string }>;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        `Failed to get outgoing edges for node ${nodeId}`,
        err,
      );
    }
  }

  /** Every l2_nodes row — used by `export-topology`. */
  getAllNodes(): L2NodeRow[] {
    try {
      return this.db.prepare("SELECT * FROM l2_nodes").all() as L2NodeRow[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        "Failed to get all l2 nodes",
        err,
      );
    }
  }

  /** Every node_links row — used by `export-topology`. */
  getAllLinks(): NodeLinkRow[] {
    try {
      return this.db.prepare("SELECT * FROM node_links").all() as NodeLinkRow[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        "Failed to get all node links",
        err,
      );
    }
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

        this.db.exec("DELETE FROM node_links");
        this.db.exec("DELETE FROM l2_node_l1_tags");
        this.db.exec("DELETE FROM l2_nodes");

        const insertNode = this.db.prepare(
          `INSERT INTO l2_nodes (project_id, name, type, description, path_patterns, node_key)
           VALUES (?, ?, 'module', '', ?, ?)`,
        );
        const keyToId = new Map<string, number>();
        for (const node of input.nodes) {
          const result = insertNode.run(
            input.projectId,
            node.name,
            JSON.stringify(node.filePath ? [node.filePath] : []),
            node.nodeKey,
          );
          keyToId.set(node.nodeKey, Number(result.lastInsertRowid));
        }

        const insertLink = this.db.prepare(
          "INSERT INTO node_links (source_node_id, target_node_id, link_type) VALUES (?, ?, ?)",
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
          "INSERT INTO l2_nodes_fts(l2_nodes_fts) VALUES('rebuild')",
        );
        this.db.exec(FTS_TRIGGER_RECREATE_SQL);

        return { nodesLoaded: input.nodes.length, edgesLoaded, edgesDropped };
      });
      return run();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        "Failed to bulk-load graph",
        err,
      );
    }
  }
}

const FTS_TRIGGER_DROP_SQL = `
  DROP TRIGGER IF EXISTS l2_nodes_fts_ai;
  DROP TRIGGER IF EXISTS l2_nodes_fts_ad;
  DROP TRIGGER IF EXISTS l2_nodes_fts_au;
`;

/** Must stay textually identical to the trigger definitions in migrations/0001_init.sql — bulkLoadGraph() drops these for the duration of the load and recreates them here afterward. */
const FTS_TRIGGER_RECREATE_SQL = `
  CREATE TRIGGER IF NOT EXISTS l2_nodes_fts_ai AFTER INSERT ON l2_nodes BEGIN
    INSERT INTO l2_nodes_fts(rowid, name, description, path_patterns)
    VALUES (new.id, new.name, new.description, new.path_patterns);
  END;
  CREATE TRIGGER IF NOT EXISTS l2_nodes_fts_ad AFTER DELETE ON l2_nodes BEGIN
    INSERT INTO l2_nodes_fts(l2_nodes_fts, rowid, name, description, path_patterns)
    VALUES ('delete', old.id, old.name, old.description, old.path_patterns);
  END;
  CREATE TRIGGER IF NOT EXISTS l2_nodes_fts_au AFTER UPDATE ON l2_nodes BEGIN
    INSERT INTO l2_nodes_fts(l2_nodes_fts, rowid, name, description, path_patterns)
    VALUES ('delete', old.id, old.name, old.description, old.path_patterns);
    INSERT INTO l2_nodes_fts(rowid, name, description, path_patterns)
    VALUES (new.id, new.name, new.description, new.path_patterns);
  END;
`;
