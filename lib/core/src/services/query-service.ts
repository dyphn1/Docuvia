import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, or, like, desc, and } from "drizzle-orm";
import { l2NodesTable, l3NodesTable } from "@workspace/db/schema";
import path from "path";
import fs from "fs";
import { LspEnrichmentService } from "./lsp-enrichment-service.js";

export interface QueryResult {
  l2?: any;
  l3: any[];
}

export class QueryService {
  public async getContext(symbol: string): Promise<any> {
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!fs.existsSync(dbPath)) throw new Error("Local database not found.");
    const sqlite = new Database(dbPath);

    // Find the target node
    const targetNode = sqlite
      .prepare("SELECT * FROM l2_nodes WHERE name = ? LIMIT 1")
      .get(symbol) as any;
    if (!targetNode) {
      sqlite.close();
      return null;
    }

    // Get incoming edges (e.g. callers)
    const incoming = sqlite
      .prepare(
        `
      SELECT l.*, n.name as source_name, n.type as source_type 
      FROM node_links l
      JOIN l2_nodes n ON l.source_node_id = n.id
      WHERE l.target_node_id = ?
    `
      )
      .all(targetNode.id) as any[];

    // Get outgoing edges (e.g. what it calls/imports)
    const outgoing = sqlite
      .prepare(
        `
      SELECT l.*, n.name as target_name, n.type as target_type 
      FROM node_links l
      JOIN l2_nodes n ON l.target_node_id = n.id
      WHERE l.source_node_id = ?
    `
      )
      .all(targetNode.id) as any[];

    sqlite.close();

    return {
      target: targetNode,
      incoming,
      outgoing,
    };
  }

  public async getImpact(symbol: string, escalateToLsp: boolean = false): Promise<any> {
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!fs.existsSync(dbPath)) throw new Error("Local database not found.");
    const sqlite = new Database(dbPath);

    // Find the target node
    const targetNode = sqlite
      .prepare("SELECT * FROM l2_nodes WHERE name = ? LIMIT 1")
      .get(symbol) as any;
    if (!targetNode) {
      sqlite.close();
      return null;
    }

    let lspEnrichedCallers: Array<{ file: string; line: number; text: string }> | undefined;

    if (escalateToLsp && targetNode.path_patterns) {
      let parsedFilePath: string | undefined;
      try {
        const paths = JSON.parse(targetNode.path_patterns);
        if (Array.isArray(paths)) {
          parsedFilePath = paths.find((p: string) => p.endsWith(".ts") || p.endsWith(".tsx"));
        }
      } catch {
        const paths = targetNode.path_patterns.split(",");
        parsedFilePath = paths
          .find((p: string) => p.trim().endsWith(".ts") || p.trim().endsWith(".tsx"))
          ?.trim();
      }

      if (parsedFilePath) {
        const absolutePath = path.resolve(this.workspaceRoot, parsedFilePath);
        const lspService = new LspEnrichmentService(this.workspaceRoot);
        lspEnrichedCallers = lspService.enrichImpact(symbol, absolutePath);
      }
    }

    // Simple BFS for blast radius (direct and indirect callers)
    let visited = new Set<string>();
    let queue = [{ id: targetNode.id, depth: 0 }];
    let impactedNodes = [];

    const getIncoming = sqlite.prepare(`
      SELECT l.source_node_id, n.name, n.type, l.link_type
      FROM node_links l
      JOIN l2_nodes n ON l.source_node_id = n.id
      WHERE l.target_node_id = ? AND l.link_type IN ('calls', 'imports', 'contains')
    `);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= 3) continue; // max depth 3
      if (visited.has(current.id)) continue;
      visited.add(current.id);

      if (current.id !== targetNode.id) {
        // we already added the target to queue initially
      }

      const callers = getIncoming.all(current.id) as any[];
      for (const caller of callers) {
        if (!visited.has(caller.source_node_id)) {
          impactedNodes.push({
            id: caller.source_node_id,
            name: caller.name,
            type: caller.type,
            link_type: caller.link_type,
            depth: current.depth + 1,
          });
          queue.push({ id: caller.source_node_id, depth: current.depth + 1 });
        }
      }
    }

    sqlite.close();

    const result: any = {
      target: targetNode,
      blastRadius: impactedNodes,
    };

    if (lspEnrichedCallers) {
      result.lspEnrichedCallers = lspEnrichedCallers;
    }

    return result;
  }

  constructor(private workspaceRoot: string) {}

  public async query(
    target: string,
    options: { local?: boolean; format?: "human" | "prompt" } = {}
  ): Promise<QueryResult> {
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");

    if (!fs.existsSync(dbPath)) {
      throw new Error(
        'Local database not found. Please run "docuvia.initProject" from VS Code to initialize it.'
      );
    }

    const sqlite = new Database(dbPath);
    const likeTarget = `%${target}%`;

    let results: { l2?: any; l3: any[] } = { l3: [] };

    const matchingL2 = sqlite
      .prepare(
        `
      SELECT * FROM l2_nodes 
      WHERE name LIKE ? OR slug LIKE ? OR path_patterns LIKE ? 
      LIMIT 1
    `
      )
      .get(likeTarget, likeTarget, likeTarget) as any;

    if (matchingL2) {
      results.l2 = matchingL2;
      const matchingL3 = sqlite
        .prepare(
          `
        SELECT * FROM l3_nodes 
        WHERE l2_node_id = ? AND (title LIKE ? OR content LIKE ?)
        ORDER BY created_at DESC LIMIT 5
      `
        )
        .all(matchingL2.id, likeTarget, likeTarget) as any[];

      if (matchingL3.length < 5) {
        const recentL3 = sqlite
          .prepare(
            `
          SELECT * FROM l3_nodes 
          WHERE l2_node_id = ? 
          ORDER BY created_at DESC LIMIT 5
        `
          )
          .all(matchingL2.id) as any[];

        const existingIds = new Set(matchingL3.map((l) => l.id));
        for (const item of recentL3) {
          if (!existingIds.has(item.id)) {
            matchingL3.push(item);
            if (matchingL3.length >= 5) break;
          }
        }
      }
      results.l3 = matchingL3;
    } else {
      results.l3 = sqlite
        .prepare(
          `
        SELECT * FROM l3_nodes 
        WHERE title LIKE ? OR content LIKE ? 
        ORDER BY created_at DESC LIMIT 5
      `
        )
        .all(likeTarget, likeTarget) as any[];
    }

    return results;
  }
}
