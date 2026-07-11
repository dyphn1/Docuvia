import type Database from "better-sqlite3";
import type { IGraphNodesRepo } from "@workspace/contracts";

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
}
