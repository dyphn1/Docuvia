import * as path from "path";
import { openLocalDatabase } from "@workspace/core";
// NOTE: Type is any since @workspace/core might have compilation issues with better-sqlite3 types,
// using any temporarily per original codebase to bypass typecheck hurdles.

export function openWorkspaceLocalDatabase(workspaceRoot: string): any {
  return openLocalDatabase(path.join(workspaceRoot, ".docuvia", "local.db"));
}

export function resolveL2NodeIdForFile(db: any, relativePath: string): number | null {
  try {
    const row = db
      .prepare("SELECT id FROM l2_nodes WHERE path_patterns = ?")
      .get(JSON.stringify([relativePath]));
    return row ? row.id : null;
  } catch {
    return null;
  }
}

export interface ExtractedDecisionLike {
  title: string;
  nodeType?: string;
  content: string;
  confidence?: number;
}

export function saveExtractedDecisions(
  db: any,
  l2NodeId: number | null,
  fileName: string,
  decisions: ExtractedDecisionLike[]
): void {
  const insert = db.prepare(
    "INSERT INTO l3_nodes (l2_node_id, title, slug, status, content, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );

  db.transaction(() => {
    for (const d of decisions) {
      const title = d.title || `Extracted from ${fileName}`;
      const slug = `extracted-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      insert.run(l2NodeId, title, slug, "proposed", d.content ?? "", new Date().toISOString());
    }
  })();
}
export function initializeL1TagsDatabase(db: any, tags: any[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS l1_tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS l2_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      type TEXT,
      source_paths TEXT,
      l1_tag_id TEXT,
      description TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS l3_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      l2_node_id INTEGER,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT,
      created_at TEXT,
      content TEXT
    );
    CREATE TABLE IF NOT EXISTS node_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_node_id INTEGER NOT NULL,
      target_node_id INTEGER NOT NULL,
      link_type TEXT,
      commit_sha TEXT,
      diff_summary TEXT
    );
  `);

  const insert = db.prepare(
    "INSERT OR REPLACE INTO l1_tags (id, name, slug, description) VALUES (?, ?, ?, ?)"
  );

  db.transaction(() => {
    for (const tag of tags) {
      const name = tag.name || "Unnamed";
      const slug =
        tag.slug ||
        name
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
      // If we don't have randomUUID here we rely on the tag id or a fallback.
      // But tags shouldn't strictly depend on vscode-client crypto.
      // The calling command provides randomUUID() if needed.
      const id = tag.id;
      const description = tag.description || "";
      insert.run(id, name, slug, description);
    }
  })();
}

export function updateL3DecisionL2ModuleId(
  db: any,
  decisionIdsToUpdate: number[],
  newL2ModuleId: number
): boolean {
  let changed = false;
  const updateStmt = db.prepare("UPDATE l3_nodes SET l2_node_id = ? WHERE id = ?");

  db.transaction(() => {
    for (const id of decisionIdsToUpdate) {
      updateStmt.run(newL2ModuleId, id);
      changed = true;
    }
  })();

  return changed;
}

export function getL1Tags(db: any): any[] {
  return db.prepare("SELECT * FROM l1_tags").all();
}

export function getL2ModulesByTagId(db: any, tagId: number): any[] {
  return db.prepare("SELECT * FROM l2_nodes WHERE l1_tag_id = ?").all(tagId);
}

export function getL3DecisionsByModuleId(db: any, moduleId: number): any[] {
  return db.prepare("SELECT * FROM l3_nodes WHERE l2_node_id = ?").all(moduleId);
}

export function getUnassignedL3Decisions(db: any): any[] {
  return db
    .prepare(
      "SELECT * FROM l3_nodes WHERE l2_node_id IS NULL OR l2_node_id NOT IN (SELECT id FROM l2_nodes)"
    )
    .all();
}

export function getUnassignedL3DecisionsCount(db: any): number {
  return db
    .prepare(
      "SELECT COUNT(*) as cnt FROM l3_nodes WHERE l2_node_id IS NULL OR l2_node_id NOT IN (SELECT id FROM l2_nodes)"
    )
    .get().cnt;
}

export function getL2ModulesCountByTagId(db: any, tagId: number): number {
  return db.prepare("SELECT COUNT(*) as c FROM l2_nodes WHERE l1_tag_id = ?").get(tagId).c;
}

export function getL3DecisionsCountByModuleId(db: any, moduleId: number): number {
  return db.prepare("SELECT COUNT(*) as c FROM l3_nodes WHERE l2_node_id = ?").get(moduleId).c;
}
