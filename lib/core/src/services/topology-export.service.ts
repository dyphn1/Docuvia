import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { TopologyExportOptions, TopologyGraph } from "../types/topology.types.js";
import { buildTopologyGraph } from "./topology-builder.js";

// Two generations of local.db exist in the wild: the current Drizzle schema
// (integer ids, `path_patterns`) and a legacy one (UUID string ids,
// `source_paths`). Ids are normalized to strings and the path column is
// detected at runtime so both are supported.
interface L2Row {
  id: number | string;
  name: string;
  paths: string | null;
}

interface LinkRow {
  source_node_id: number | string;
  target_node_id: number | string;
  link_type: string;
}

interface L3Row {
  id: number | string;
  l2_node_id: number | string;
  title: string;
  // The local L3 table has been created with two shapes over time; both status
  // columns are optional and read defensively.
  status?: string | null;
  validity_status?: string | null;
}

/**
 * Local-first (SQLite) topology export: reads .docuvia/local.db and delegates
 * the projection to the shared buildTopologyGraph. Read-only — no migrations.
 */
export class TopologyExportService {
  constructor(private workspaceRoot: string) {}

  public exportTopology(options: TopologyExportOptions = {}): TopologyGraph {
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!fs.existsSync(dbPath)) {
      throw new Error(
        'Local database not found. Please run "docuvia analyze" or "docuvia.initProject" first.'
      );
    }

    const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const l2Columns = (
        sqlite.prepare("PRAGMA table_info(l2_nodes)").all() as Array<{ name: string }>
      ).map((c) => c.name);
      const pathColumn = l2Columns.includes("path_patterns")
        ? "path_patterns"
        : l2Columns.includes("source_paths")
          ? "source_paths"
          : null;

      const l2Rows = sqlite
        .prepare(
          pathColumn
            ? `SELECT id, name, ${pathColumn} AS paths FROM l2_nodes`
            : "SELECT id, name, NULL AS paths FROM l2_nodes"
        )
        .all() as L2Row[];
      const linkRows = sqlite
        .prepare("SELECT source_node_id, target_node_id, link_type FROM node_links")
        .all() as LinkRow[];

      // l3_nodes and tag tables may not exist yet in a fresh workspace — treat as empty.
      let l3Rows: L3Row[] = [];
      try {
        l3Rows = sqlite.prepare("SELECT * FROM l3_nodes").all() as L3Row[];
      } catch {
        l3Rows = [];
      }
      let tagRows: Array<{ l2_node_id: number | string; name: string }> = [];
      try {
        tagRows = sqlite
          .prepare(
            `SELECT lt.l2_node_id, t.name FROM l2_node_l1_tags lt JOIN l1_tags t ON t.id = lt.l1_tag_id`
          )
          .all() as Array<{ l2_node_id: number | string; name: string }>;
      } catch {
        tagRows = [];
      }

      const activeL3 = l3Rows.filter((row) => {
        if (typeof row.status === "string") return row.status === "active";
        if (typeof row.validity_status === "string") return row.validity_status !== "invalid";
        return true;
      });

      return buildTopologyGraph(
        {
          workspaceRoot: this.workspaceRoot,
          l2Rows: l2Rows.map((row) => ({
            id: row.id,
            name: row.name,
            filePath: parseFirstPathPattern(row.paths),
          })),
          linkRows: linkRows.map((link) => ({
            sourceNodeId: link.source_node_id,
            targetNodeId: link.target_node_id,
            linkType: link.link_type,
          })),
          l3Rows: activeL3.map((row) => ({
            id: row.id,
            l2NodeId: row.l2_node_id,
            title: row.title,
          })),
          tagRows: tagRows.map((row) => ({ l2NodeId: row.l2_node_id, name: row.name })),
        },
        options
      );
    } finally {
      sqlite.close();
    }
  }
}

function parseFirstPathPattern(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
  } catch {
    // Legacy rows may store a bare path instead of a JSON array.
    if (raw.trim()) return raw.trim();
  }
  return undefined;
}
