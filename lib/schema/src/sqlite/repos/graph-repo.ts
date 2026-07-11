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
      .prepare(`DELETE FROM l2_node_l1_tags WHERE l2_node_id IN (${placeholders})`)
      .run(...ids);
    this.db.prepare(`DELETE FROM node_links WHERE source_node_id IN (${placeholders})`).run(...ids);
    this.db.prepare(`DELETE FROM l2_nodes WHERE id IN (${placeholders})`).run(...ids);
    return ids;
  }

  /** Inserts an l2_node (file/function/class) and returns its new id. */
  insertNode(input: {
    projectId: number;
    name: string;
    type?: string;
    description?: string;
    pathPatterns: string[];
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO l2_nodes (project_id, name, type, description, path_patterns)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.projectId,
        input.name,
        input.type ?? "module",
        input.description ?? "",
        JSON.stringify(input.pathPatterns)
      );
    return Number(result.lastInsertRowid);
  }

  /** Inserts a node_links edge between two l2_nodes. */
  insertLink(input: { sourceNodeId: number; targetNodeId: number; linkType: string }): void {
    this.db
      .prepare("INSERT INTO node_links (source_node_id, target_node_id, link_type) VALUES (?, ?, ?)")
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
        this.db.prepare("SELECT COUNT(*) as c FROM l2_nodes").get() as { c: number }
      ).c;
      const l3Nodes = (
        this.db.prepare("SELECT COUNT(*) as c FROM l3_nodes").get() as { c: number }
      ).c;
      return { l2Nodes, l3Nodes };
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.DB_QUERY_FAILED, "Failed to count l2/l3 nodes", err);
    }
  }

  /**
   * l2_nodes whose `path_patterns` intersects `changedFiles`, each paired with its l3_nodes —
   * used by `sync` (mirrors old Docuvia's `SyncService.readLocalCandidates`).
   */
  findNodesForChangedFiles(changedFiles: string[]): L2NodeWithL3Children[] {
    try {
      const changedSet = new Set(changedFiles);
      const allNodes = this.db.prepare("SELECT * FROM l2_nodes").all() as L2NodeRow[];

      const candidates = allNodes.filter((node) => {
        if (!node.path_patterns) return false;
        try {
          const patterns: string[] = JSON.parse(node.path_patterns);
          return patterns.some((p) => changedSet.has(p));
        } catch {
          return false;
        }
      });

      const l3Stmt = this.db.prepare("SELECT * FROM l3_nodes WHERE l2_node_id = ?");
      return candidates.map((l2Node) => ({
        l2Node,
        l3Nodes: l3Stmt.all(l2Node.id) as L3NodeRow[],
      }));
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        "Failed to find nodes for changed files",
        err
      );
    }
  }

  /**
   * Resolves a node by name: exact match first, falling back to a `LIKE %target%` match
   * (mirrors old Docuvia's `QueryService.findNodeByName`).
   */
  findNodeByName(target: string): { id: number; name: string; type: string } | undefined {
    try {
      const exact = this.db
        .prepare("SELECT id, name, type FROM l2_nodes WHERE name = ? LIMIT 1")
        .get(target) as { id: number; name: string; type: string } | undefined;
      if (exact) return exact;

      const escaped = target.replace(/[\\%_]/g, (m) => `\\${m}`);
      return this.db
        .prepare("SELECT id, name, type FROM l2_nodes WHERE name LIKE ? ESCAPE '\\' LIMIT 1")
        .get(`%${escaped}%`) as { id: number; name: string; type: string } | undefined;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        `Failed to find node by name: ${target}`,
        err
      );
    }
  }

  /**
   * Nodes with an outgoing node_links edge INTO nodeId — the 1-hop "blast radius". `DISTINCT`
   * dedupes a neighbor that's connected by more than one edge type (e.g. both a `calls` and a
   * `depends_on` link between the same pair of nodes), so it isn't double-counted.
   */
  getIncomingEdges(nodeId: number): Array<{ id: number; name: string; type: string }> {
    try {
      return this.db
        .prepare(
          `SELECT DISTINCT n.id as id, n.name as name, n.type as type
           FROM node_links l
           JOIN l2_nodes n ON n.id = l.source_node_id
           WHERE l.target_node_id = ?`
        )
        .all(nodeId) as Array<{ id: number; name: string; type: string }>;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        `Failed to get incoming edges for node ${nodeId}`,
        err
      );
    }
  }

  /** Nodes nodeId links out to. See `getIncomingEdges()`'s doc comment on the `DISTINCT`. */
  getOutgoingEdges(nodeId: number): Array<{ id: number; name: string; type: string }> {
    try {
      return this.db
        .prepare(
          `SELECT DISTINCT n.id as id, n.name as name, n.type as type
           FROM node_links l
           JOIN l2_nodes n ON n.id = l.target_node_id
           WHERE l.source_node_id = ?`
        )
        .all(nodeId) as Array<{ id: number; name: string; type: string }>;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        `Failed to get outgoing edges for node ${nodeId}`,
        err
      );
    }
  }

  /** Every l2_nodes row — used by `export-topology`. */
  getAllNodes(): L2NodeRow[] {
    try {
      return this.db.prepare("SELECT * FROM l2_nodes").all() as L2NodeRow[];
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.DB_QUERY_FAILED, "Failed to get all l2 nodes", err);
    }
  }

  /** Every node_links row — used by `export-topology`. */
  getAllLinks(): NodeLinkRow[] {
    try {
      return this.db.prepare("SELECT * FROM node_links").all() as NodeLinkRow[];
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.DB_QUERY_FAILED, "Failed to get all node links", err);
    }
  }
}
