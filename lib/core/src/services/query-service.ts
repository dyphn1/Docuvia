import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";
import { SqliteGraphRepository } from "./sqlite-graph.repository.js";
import { LocalQueryIntent } from "../types/intent-router.types.js";
import { LOCAL_DB_NOT_FOUND_MESSAGE } from "./status-service.js";

export interface LocalContextResult {
  incoming: Array<{ source_name: string; source_type: string }>;
  outgoing: Array<{ target_name: string; target_type: string }>;
}

export interface LocalImpactResult {
  blastRadius: Array<{ name: string; type: string }>;
}

export class QueryService {
  constructor(
    private workspaceRoot: string = process.cwd(),
    private graphRepository: SqliteGraphRepository = new SqliteGraphRepository()
  ) {}

  private getDbPath(): string {
    return path.join(this.workspaceRoot, ".docuvia", "local.db");
  }

  private assertDbExists(): void {
    if (!fs.existsSync(this.getDbPath())) {
      throw new Error(LOCAL_DB_NOT_FOUND_MESSAGE);
    }
  }

  /**
   * Local-first natural-language query (ADR-002/ADR-029): resolves a plain-string target
   * against the SQLite FTS5 index and the AST graph, bucketed into the {l2, l3} shape the
   * CLI's `query` command and `formatPromptOutput` expect.
   */
  public async query(
    target: string,
    options: any
  ): Promise<{
    l2: { name: string } | null;
    l3: Array<{ title: string; status?: string; content: string | null }>;
  }> {
    logger.info({ target, options }, "Querying local knowledge graph");
    this.assertDbExists();

    const intent: LocalQueryIntent = {
      keywords: target.split(/\s+/).filter(Boolean),
      nodeRefs: [target],
    };

    const results = await this.graphRepository.searchLocalNodes(
      this.workspaceRoot,
      intent,
      options?.limit ?? 10
    );

    const l2Result = results.find((r) => r.nodeLayer === "l2");
    const l3Results = results.filter((r) => r.nodeLayer === "l3");

    return {
      l2: l2Result ? { name: l2Result.title } : null,
      l3: l3Results.map((r) => ({ title: r.title, content: r.content })),
    };
  }

  /**
   * Structural context (incoming/outgoing edges) for a symbol/module, resolved against the
   * local SQLite AST graph (node_links). Used by the `docuvia_context` MCP tool and the
   * VS Code hover provider — both are local, workspace-scoped operations, so this deliberately
   * never reaches for the Postgres-backed ImpactAnalysisService.
   */
  public async getContext(target: string): Promise<LocalContextResult | null> {
    this.assertDbExists();
    const db = new Database(this.getDbPath(), { readonly: true });
    try {
      const node = this.findNodeByName(db, target);
      if (!node) return null;

      const incoming = db
        .prepare(
          `SELECT n.name as source_name, n.type as source_type
           FROM node_links l
           JOIN l2_nodes n ON n.id = l.source_node_id
           WHERE l.target_node_id = ?`
        )
        .all(node.id) as Array<{ source_name: string; source_type: string }>;

      const outgoing = db
        .prepare(
          `SELECT n.name as target_name, n.type as target_type
           FROM node_links l
           JOIN l2_nodes n ON n.id = l.target_node_id
           WHERE l.source_node_id = ?`
        )
        .all(node.id) as Array<{ target_name: string; target_type: string }>;

      return { incoming, outgoing };
    } finally {
      db.close();
    }
  }

  /**
   * Blast radius (direct callers/dependents) for a symbol/module. `escalateToLsp` is reserved
   * for a future TypeScript-compiler-backed precise reference resolution pass; the local-first
   * graph traversal below is the current (non-LSP) implementation.
   */
  public async getImpact(
    target: string,
    escalateToLsp?: boolean
  ): Promise<LocalImpactResult | null> {
    this.assertDbExists();
    const db = new Database(this.getDbPath(), { readonly: true });
    try {
      const node = this.findNodeByName(db, target);
      if (!node) return null;

      const blastRadius = db
        .prepare(
          `SELECT n.name as name, n.type as type
           FROM node_links l
           JOIN l2_nodes n ON n.id = l.source_node_id
           WHERE l.target_node_id = ?`
        )
        .all(node.id) as Array<{ name: string; type: string }>;

      return { blastRadius };
    } finally {
      db.close();
    }
  }

  private findNodeByName(
    db: Database.Database,
    target: string
  ): { id: number; name: string; type: string } | undefined {
    const exact = db
      .prepare("SELECT id, name, type FROM l2_nodes WHERE name = ? LIMIT 1")
      .get(target) as { id: number; name: string; type: string } | undefined;
    if (exact) return exact;

    const escaped = target.replace(/[\\%_]/g, (m) => `\\${m}`);
    return db
      .prepare("SELECT id, name, type FROM l2_nodes WHERE name LIKE ? ESCAPE '\\' LIMIT 1")
      .get(`%${escaped}%`) as { id: number; name: string; type: string } | undefined;
  }
}
