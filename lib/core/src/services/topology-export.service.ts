import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { TopologyGraph, TopologyExportOptions } from "../types/topology.types.js";
import {
  buildTopologyGraph,
  TopologyBuildInput,
  TopologyBuildL3Row,
  TopologyBuildTagRow,
} from "./topology-builder.js";
import { logger } from "../utils/logger.js";
import { appendCommandLogLine } from "./command-log-writer.js";
import { EXPORT_TOPOLOGY_LOG_FILE_NAME } from "../constants/paths.js";

const LOCAL_DB_NOT_FOUND_MESSAGE = 'Local database not found. Please run "docuvia init".';

export class TopologyExportService {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public async exportTopology(options: TopologyExportOptions = {}): Promise<TopologyGraph> {
    logger.info({ options }, "Exporting topology");
    await appendCommandLogLine(this.workspaceRoot, EXPORT_TOPOLOGY_LOG_FILE_NAME, {
      event: "export-topology.start",
      collapse: options.collapse ?? null,
    }).catch(() => {});

    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!fs.existsSync(dbPath)) {
      await appendCommandLogLine(this.workspaceRoot, EXPORT_TOPOLOGY_LOG_FILE_NAME, {
        event: "export-topology.error",
        message: LOCAL_DB_NOT_FOUND_MESSAGE,
      }).catch(() => {});
      throw new Error(LOCAL_DB_NOT_FOUND_MESSAGE);
    }

    const db = new Database(dbPath, { readonly: true });
    try {
      const input = this.loadInput(db);
      const graph = buildTopologyGraph(input, options);
      await appendCommandLogLine(this.workspaceRoot, EXPORT_TOPOLOGY_LOG_FILE_NAME, {
        event: "export-topology.summary",
        nodeCount: graph.stats.nodeCount,
        linkCount: graph.stats.linkCount,
        groupCount: graph.stats.groupCount,
        collapsed: graph.collapsed,
      }).catch(() => {});
      return graph;
    } finally {
      db.close();
    }
  }

  private tableExists(db: Database.Database, name: string): boolean {
    return !!db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
  }

  private columnNames(db: Database.Database, table: string): Set<string> {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return new Set(rows.map((r) => r.name));
  }

  /** L2/L3 path/tag columns store a JSON string array; fall back to the raw string otherwise. */
  private parseFilePath(raw: unknown): string | undefined {
    if (typeof raw !== "string" || raw.length === 0) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return String(parsed[0]);
    } catch {
      // Not JSON — treat the raw value itself as the path.
    }
    return raw;
  }

  /** Excludes stale/superseded decisions (garbage in the current schema, archived in the legacy one). */
  private isExportableStatus(statusColumn: string, status: string | undefined): boolean {
    if (status === undefined) return true;
    const excluded = statusColumn === "validity_status" ? ["garbage"] : ["archived"];
    return !excluded.includes(status);
  }

  private loadInput(db: Database.Database): TopologyBuildInput {
    const l2Columns = this.columnNames(db, "l2_nodes");
    const pathColumn = l2Columns.has("path_patterns")
      ? "path_patterns"
      : l2Columns.has("source_paths")
        ? "source_paths"
        : undefined;

    const l2Rows = (
      db
        .prepare(`SELECT id, name${pathColumn ? `, ${pathColumn} as path_raw` : ""} FROM l2_nodes`)
        .all() as Array<{ id: number | string; name: string; path_raw?: string }>
    ).map((row) => ({
      id: row.id,
      name: row.name,
      filePath: this.parseFilePath(row.path_raw),
    }));

    const linkRows = (
      db
        .prepare(`SELECT source_node_id, target_node_id, link_type FROM node_links`)
        .all() as Array<{
        source_node_id: number | string;
        target_node_id: number | string;
        link_type: string;
      }>
    ).map((row) => ({
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      linkType: row.link_type,
    }));

    let l3Rows: TopologyBuildL3Row[] = [];
    if (this.tableExists(db, "l3_nodes")) {
      const l3Columns = this.columnNames(db, "l3_nodes");
      const statusColumn = l3Columns.has("validity_status")
        ? "validity_status"
        : l3Columns.has("status")
          ? "status"
          : undefined;

      const rawRows = db
        .prepare(
          `SELECT id, l2_node_id, title${statusColumn ? `, ${statusColumn} as status_raw` : ""} FROM l3_nodes`
        )
        .all() as Array<{
        id: number | string;
        l2_node_id: number | string;
        title: string;
        status_raw?: string;
      }>;

      l3Rows = rawRows
        .filter((row) => !statusColumn || this.isExportableStatus(statusColumn, row.status_raw))
        .map((row) => ({ id: row.id, l2NodeId: row.l2_node_id, title: row.title }));
    }

    let tagRows: TopologyBuildTagRow[] = [];
    if (this.tableExists(db, "l2_node_l1_tags") && this.tableExists(db, "l1_tags")) {
      tagRows = (
        db
          .prepare(
            `SELECT lt.l2_node_id as l2_node_id, t.name as name
             FROM l2_node_l1_tags lt
             JOIN l1_tags t ON t.id = lt.l1_tag_id`
          )
          .all() as Array<{ l2_node_id: number | string; name: string }>
      ).map((row) => ({ l2NodeId: row.l2_node_id, name: row.name }));
    }

    return {
      workspaceRoot: this.workspaceRoot,
      l2Rows,
      linkRows,
      l3Rows,
      tagRows,
    };
  }
}
