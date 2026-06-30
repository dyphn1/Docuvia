import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export interface SnapshotData {
  tags: any[];
  modules: any[];
  routerIndex: any[];
  decisions: Map<string, any>;
  edges: any[];
  projectName?: string;
}

export class LocalSnapshotService {
  constructor(private workspaceRoot: string) {}

  public getSnapshot(): SnapshotData | null {
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!fs.existsSync(dbPath)) {
      return null;
    }

    try {
      const db = new Database(dbPath, { readonly: true });
      let tags: any[] = [];
      let modules: any[] = [];
      let routerIndex: any[] = [];
      let decisions = new Map<string, any>();
      let edges: any[] = [];

      const l1Rows = db.prepare("SELECT * FROM l1_tags").all() as any[];
      tags = l1Rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
      }));

      const l2Rows = db.prepare("SELECT * FROM l2_nodes").all() as any[];
      modules = l2Rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        l1_tag_id: row.l1_tag_id,
        source_paths: row.source_paths ? JSON.parse(row.source_paths) : [],
        description: row.description,
      }));

      const l3Rows = db.prepare("SELECT * FROM l3_nodes").all() as any[];
      routerIndex = l3Rows.map((row) => ({
        id: row.id,
        l2_module_id: row.l2_node_id,
        title: row.title,
        slug: row.slug || "",
        file_path: "",
      }));

      for (const row of l3Rows) {
        decisions.set(row.id, {
          id: row.id,
          l2_module_id: row.l2_node_id,
          title: row.title,
          status: row.status,
          date: row.created_at,
          body: row.content || "",
          filePath: "",
        });
      }

      try {
        const linkRows = db
          .prepare("SELECT id, source_node_id, target_node_id, link_type FROM node_links")
          .all() as any[];
        edges = linkRows.map((row) => ({
          id: row.id,
          sourceNodeId: row.source_node_id,
          targetNodeId: row.target_node_id,
          linkType: row.link_type,
        }));
      } catch (linkErr) {
        // non-fatal
        console.warn(`[LocalSnapshotService] node_links not available: ${String(linkErr)}`);
      }

      db.close();

      return {
        tags,
        modules,
        routerIndex,
        decisions,
        edges,
        projectName: tags.length > 0 ? tags[0].name : undefined,
      };
    } catch (err) {
      console.error(`[LocalSnapshotService] Local fallback failed: ${String(err)}`);
      return null;
    }
  }
}

export interface TraversalNode {
  id: number;
  name: string;
  type: string;
  depth: number;
}

export interface TraversalResult {
  rootId: number;
  rootName: string;
  direction: "dependencies" | "dependents" | "both";
  nodes: TraversalNode[];
  edges: any[];
  maxDepth: number;
}

export class LocalGraphTraversalService {
  public static traverseLocalSqlite(
    workspaceRoot: string,
    rootNodeId: number,
    direction: "dependencies" | "dependents" | "both",
    maxDepth: number
  ): TraversalResult | null {
    const dbPath = path.join(workspaceRoot, ".docuvia", "local.db");
    try {
      if (!fs.existsSync(dbPath)) return null;

      const db = new Database(dbPath, { readonly: true });

      const tableCheck = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='node_links'")
        .get();
      if (!tableCheck) {
        db.close();
        return null;
      }

      const rootRow = db
        .prepare("SELECT id, name, type FROM l2_nodes WHERE id = ?")
        .get(rootNodeId) as any;
      if (!rootRow) {
        db.close();
        return null;
      }

      const nodes: TraversalNode[] = [
        { id: rootRow.id, name: rootRow.name, type: rootRow.type ?? "module", depth: 0 },
      ];
      const edges: any[] = [];
      let actualMaxDepth = 0;

      if (direction === "dependencies" || direction === "both") {
        const depRows = db
          .prepare(
            `
          WITH RECURSIVE deps AS (
            SELECT source_node_id, target_node_id, link_type, 1 AS depth
            FROM node_links
            WHERE source_node_id = ?
            UNION ALL
            SELECT nl.source_node_id, nl.target_node_id, nl.link_type, d.depth + 1
            FROM node_links nl
            INNER JOIN deps d ON nl.source_node_id = d.target_node_id
            WHERE d.depth < ?
          )
          SELECT d.target_node_id AS node_id, d.source_node_id, d.target_node_id, d.link_type, d.depth,
                 n.name, n.type
          FROM deps d
          LEFT JOIN l2_nodes n ON n.id = d.target_node_id
        `
          )
          .all(rootNodeId, maxDepth) as any[];

        for (const row of depRows) {
          if (row.depth > actualMaxDepth) actualMaxDepth = row.depth;
          if (!nodes.find((n) => n.id === row.node_id)) {
            nodes.push({
              id: row.node_id,
              name: row.name ?? `node-${row.node_id}`,
              type: row.type ?? "module",
              depth: row.depth,
            });
          }
          edges.push({
            id: 0,
            sourceNodeId: row.source_node_id,
            targetNodeId: row.target_node_id,
            linkType: row.link_type,
          });
        }
      }

      if (direction === "dependents" || direction === "both") {
        const depRows = db
          .prepare(
            `
          WITH RECURSIVE dependents AS (
            SELECT source_node_id, target_node_id, link_type, 1 AS depth
            FROM node_links
            WHERE target_node_id = ?
            UNION ALL
            SELECT nl.source_node_id, nl.target_node_id, nl.link_type, d.depth + 1
            FROM node_links nl
            INNER JOIN dependents d ON nl.target_node_id = d.source_node_id
            WHERE d.depth < ?
          )
          SELECT d.source_node_id AS node_id, d.source_node_id, d.target_node_id, d.link_type, d.depth,
                 n.name, n.type
          FROM dependents d
          LEFT JOIN l2_nodes n ON n.id = d.source_node_id
        `
          )
          .all(rootNodeId, maxDepth) as any[];

        for (const row of depRows) {
          if (row.depth > actualMaxDepth) actualMaxDepth = row.depth;
          if (!nodes.find((n) => n.id === row.node_id)) {
            nodes.push({
              id: row.node_id,
              name: row.name ?? `node-${row.node_id}`,
              type: row.type ?? "module",
              depth: row.depth,
            });
          }
          edges.push({
            id: 0,
            sourceNodeId: row.source_node_id,
            targetNodeId: row.target_node_id,
            linkType: row.link_type,
          });
        }
      }

      db.close();
      return {
        rootId: rootNodeId,
        rootName: rootRow.name,
        direction,
        nodes,
        edges,
        maxDepth: actualMaxDepth,
      };
    } catch (err) {
      console.warn(`[LocalGraphTraversalService] SQLite traversal failed: ${String(err)}`);
      return null;
    }
  }
}
