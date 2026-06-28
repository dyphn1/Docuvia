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
    const db = drizzle(sqlite);
    const likeTarget = `%${target}%`;

    const l2Nodes = l2NodesTable as any;
    const l3Nodes = l3NodesTable as any;

    const matchingL2 = db
      .select()
      .from(l2Nodes)
      .where(
        or(
          like(l2Nodes.name, likeTarget),
          like(l2Nodes.slug, likeTarget),
          like(l2Nodes.source_paths, likeTarget)
        )
      )
      .limit(1)
      .get() as any;

    let results: { l2?: any; l3: any[] } = { l3: [] };

    if (matchingL2) {
      results.l2 = matchingL2;
      const matchingL3 = db
        .select()
        .from(l3Nodes)
        .where(
          and(
            eq(l3Nodes.l2NodeId, matchingL2.id),
            or(like(l3Nodes.title, likeTarget), like(l3Nodes.content, likeTarget))
          )
        )
        .orderBy(desc(l3Nodes.createdAt))
        .limit(5)
        .all() as any[];

      if (matchingL3.length < 5) {
        const recentL3 = db
          .select()
          .from(l3Nodes)
          .where(eq(l3Nodes.l2NodeId, matchingL2.id))
          .orderBy(desc(l3Nodes.createdAt))
          .limit(5)
          .all() as any[];

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
      results.l3 = db
        .select()
        .from(l3Nodes)
        .where(or(like(l3Nodes.title, likeTarget), like(l3Nodes.content, likeTarget)))
        .orderBy(desc(l3Nodes.createdAt))
        .limit(5)
        .all() as any[];
    }

    return results;
  }
}
