import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";
import { SqliteGraphRepository } from "./sqlite-graph.repository.js";
import { LocalQueryIntent } from "../types/intent-router.types.js";
import { LOCAL_DB_NOT_FOUND_MESSAGE } from "./status-service.js";
import { appendCommandLogLine } from "./command-log-writer.js";
import { QUERY_LOG_FILE_NAME } from "../constants/paths.js";

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
    l2: { name: string; slug?: string } | null;
    l3: Array<{ title: string; status?: string; content: string | null }>;
    context: LocalContextResult | null;
  }> {
    logger.info({ target, options }, "Querying local knowledge graph");
    await appendCommandLogLine(this.workspaceRoot, QUERY_LOG_FILE_NAME, {
      event: "query.start",
      target,
      format: options?.format,
    }).catch(() => {});

    try {
      this.assertDbExists();
    } catch (err: any) {
      await appendCommandLogLine(this.workspaceRoot, QUERY_LOG_FILE_NAME, {
        event: "query.error",
        target,
        message: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
      throw err;
    }

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

    // Additive: richer structural context (incoming/outgoing edges) from the AST graph,
    // alongside the existing name-based l2/l3 lookup above. `getContext()` resolves `target`
    // itself (exact/LIKE match against l2_nodes) rather than reusing l2Result, since a fuzzy
    // FTS match here may not correspond to an exact graph node (in which case this is null).
    let context: LocalContextResult | null = null;
    try {
      context = await this.getContext(target);
    } catch {
      // getContext() throws if the local DB doesn't exist, but assertDbExists() above already
      // guarantees it does — this catch only guards against unexpected lookup failures so
      // query() never throws because of the additive context lookup.
      context = null;
    }

    const found = Boolean(l2Result) || l3Results.length > 0 || Boolean(context);
    await appendCommandLogLine(this.workspaceRoot, QUERY_LOG_FILE_NAME, {
      event: "query.summary",
      target,
      found,
    }).catch(() => {});

    return {
      l2: l2Result ? { name: l2Result.title, slug: l2Result.title } : null,
      l3: l3Results.map((r) => ({ title: r.title, content: r.content })),
      context,
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

      const incoming = this.queryIncomingEdges(db, node.id).map((r) => ({
        source_name: r.name,
        source_type: r.type,
      }));

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

      return { blastRadius: this.queryIncomingEdges(db, node.id) };
    } finally {
      db.close();
    }
  }

  private queryIncomingEdges(
    db: Database.Database,
    nodeId: number
  ): Array<{ name: string; type: string }> {
    return db
      .prepare(
        `SELECT n.name as name, n.type as type
         FROM node_links l
         JOIN l2_nodes n ON n.id = l.source_node_id
         WHERE l.target_node_id = ?`
      )
      .all(nodeId) as Array<{ name: string; type: string }>;
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
