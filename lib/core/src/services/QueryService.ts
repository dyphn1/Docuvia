import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, or, like, desc, and } from "drizzle-orm";
import { l2NodesTable, l3NodesTable } from "@workspace/db/schema";
import path from "path";
import fs from "fs";

export interface QueryResult {
  l2?: any;
  l3: any[];
}

export class QueryService {
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

    const matchingL2 = sqlite.prepare(`
      SELECT * FROM l2_nodes 
      WHERE name LIKE ? OR slug LIKE ? OR source_paths LIKE ? 
      LIMIT 1
    `).get(likeTarget, likeTarget, likeTarget) as any;

    if (matchingL2) {
      results.l2 = matchingL2;
      const matchingL3 = sqlite.prepare(`
        SELECT * FROM l3_nodes 
        WHERE l2_node_id = ? AND (title LIKE ? OR content LIKE ?)
        ORDER BY created_at DESC LIMIT 5
      `).all(matchingL2.id, likeTarget, likeTarget) as any[];

      if (matchingL3.length < 5) {
        const recentL3 = sqlite.prepare(`
          SELECT * FROM l3_nodes 
          WHERE l2_node_id = ? 
          ORDER BY created_at DESC LIMIT 5
        `).all(matchingL2.id) as any[];

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
      results.l3 = sqlite.prepare(`
        SELECT * FROM l3_nodes 
        WHERE title LIKE ? OR content LIKE ? 
        ORDER BY created_at DESC LIMIT 5
      `).all(likeTarget, likeTarget) as any[];
    }

    return results;
  }
}
