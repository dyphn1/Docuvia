import type Database from "better-sqlite3";

/**
 * SQLite FTS5 index setup for the local knowledge graph (ADR-029).
 *
 * Local mode never uses vector search (server-only via pgvector, ADR-019).
 * Instead, natural-language queries degrade to FTS5 keyword matching plus
 * AST graph traversal. The FTS tables are external-content indexes over
 * l2_nodes / l3_nodes, kept in sync by triggers so existing write paths
 * (Drizzle inserts in SqliteGraphRepository) require no changes.
 */

const L2_FTS_SCHEMA_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS l2_nodes_fts USING fts5(
    name, description, path_patterns,
    content='l2_nodes', content_rowid='id'
  );
  CREATE TRIGGER IF NOT EXISTS l2_nodes_fts_ai AFTER INSERT ON l2_nodes BEGIN
    INSERT INTO l2_nodes_fts(rowid, name, description, path_patterns)
    VALUES (new.id, new.name, new.description, new.path_patterns);
  END;
  CREATE TRIGGER IF NOT EXISTS l2_nodes_fts_ad AFTER DELETE ON l2_nodes BEGIN
    INSERT INTO l2_nodes_fts(l2_nodes_fts, rowid, name, description, path_patterns)
    VALUES ('delete', old.id, old.name, old.description, old.path_patterns);
  END;
  CREATE TRIGGER IF NOT EXISTS l2_nodes_fts_au AFTER UPDATE ON l2_nodes BEGIN
    INSERT INTO l2_nodes_fts(l2_nodes_fts, rowid, name, description, path_patterns)
    VALUES ('delete', old.id, old.name, old.description, old.path_patterns);
    INSERT INTO l2_nodes_fts(rowid, name, description, path_patterns)
    VALUES (new.id, new.name, new.description, new.path_patterns);
  END;
`;

const L3_FTS_SCHEMA_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS l3_nodes_fts USING fts5(
    title, content,
    content='l3_nodes', content_rowid='id'
  );
  CREATE TRIGGER IF NOT EXISTS l3_nodes_fts_ai AFTER INSERT ON l3_nodes BEGIN
    INSERT INTO l3_nodes_fts(rowid, title, content)
    VALUES (new.id, new.title, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS l3_nodes_fts_ad AFTER DELETE ON l3_nodes BEGIN
    INSERT INTO l3_nodes_fts(l3_nodes_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
  END;
  CREATE TRIGGER IF NOT EXISTS l3_nodes_fts_au AFTER UPDATE ON l3_nodes BEGIN
    INSERT INTO l3_nodes_fts(l3_nodes_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
    INSERT INTO l3_nodes_fts(rowid, title, content)
    VALUES (new.id, new.title, new.content);
  END;
`;

function tableExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

/**
 * Ensures the FTS5 virtual tables and sync triggers exist on a local.db handle.
 * When an FTS table is created for the first time on a pre-existing database
 * (self-heal path), the index is rebuilt from the content tables so previously
 * persisted nodes become searchable.
 */
export function ensureLocalFtsIndex(sqlite: Database.Database): void {
  if (tableExists(sqlite, "l2_nodes")) {
    const hadL2Fts = tableExists(sqlite, "l2_nodes_fts");
    sqlite.exec(L2_FTS_SCHEMA_SQL);
    if (!hadL2Fts) {
      sqlite.exec("INSERT INTO l2_nodes_fts(l2_nodes_fts) VALUES('rebuild');");
    }
  }
  if (tableExists(sqlite, "l3_nodes")) {
    const hadL3Fts = tableExists(sqlite, "l3_nodes_fts");
    sqlite.exec(L3_FTS_SCHEMA_SQL);
    if (!hadL3Fts) {
      sqlite.exec("INSERT INTO l3_nodes_fts(l3_nodes_fts) VALUES('rebuild');");
    }
  }
}

/**
 * Builds an FTS5 MATCH expression from extracted keywords: each keyword is
 * quoted as a phrase (neutralizing FTS5 operators in user input) and combined
 * with OR. Returns null when no usable keywords remain.
 */
export function buildFtsMatchExpression(keywords: string[]): string | null {
  const phrases = keywords
    .map((k) => k.replace(/"/g, "").trim())
    .filter((k) => k.length > 0)
    .map((k) => `"${k}"`);
  return phrases.length > 0 ? phrases.join(" OR ") : null;
}
