-- 0001_init.sql
-- Local-SQLite knowledge-graph schema (ported from old Docuvia's
-- lib/core/src/constants/schema.sql, plus the FTS5 virtual tables/triggers
-- from lib/core/src/services/sqlite-fts.ts folded into the same migration so
-- GraphStore.open() is the single place that guarantees full schema readiness).
--
-- Table shapes match old schema.sql's columns/types exactly. NOT NULL/DEFAULT
-- are applied wherever old schema.sql declared a DEFAULT (matching the
-- lib/db Drizzle sqlite schema's nullability, which the raw DDL never
-- formally captured) so the hand-written row types in ./types.ts can encode
-- accurate nullability instead of guessing.

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  vcs_type TEXT NOT NULL DEFAULT 'git',
  svn_url TEXT,
  last_git_ingested_at TEXT,
  last_svn_revision INTEGER,
  last_ast_ingested_at TEXT,
  owner_id INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  content_hash TEXT,
  last_parsed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, file_path)
);
CREATE INDEX IF NOT EXISTS project_files_project_id_idx ON project_files(project_id);

CREATE TABLE IF NOT EXISTS l1_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Feature',
  is_anchored INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS l2_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'module',
  is_system INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 1,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
  path_patterns TEXT,
  reindex_required INTEGER NOT NULL DEFAULT 0,
  is_bootstrap_confirmed INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS l2_nodes_project_id_idx ON l2_nodes(project_id);
CREATE INDEX IF NOT EXISTS l2_nodes_name_idx ON l2_nodes(name);
CREATE INDEX IF NOT EXISTS l2_nodes_content_hash_idx ON l2_nodes(content_hash);

CREATE TABLE IF NOT EXISTS node_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_node_id INTEGER NOT NULL,
  target_node_id INTEGER NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'depends_on',
  commit_sha TEXT,
  diff_summary TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS node_links_source_node_idx ON node_links(source_node_id);
CREATE INDEX IF NOT EXISTS node_links_target_node_idx ON node_links(target_node_id);

CREATE TABLE IF NOT EXISTS l2_node_l1_tags (
  l2_node_id INTEGER NOT NULL,
  l1_tag_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS l2_node_l1_tags_l2_node_idx ON l2_node_l1_tags(l2_node_id);
CREATE INDEX IF NOT EXISTS l2_node_l1_tags_l1_tag_idx ON l2_node_l1_tags(l1_tag_id);

CREATE TABLE IF NOT EXISTS l3_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  l2_node_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  node_type TEXT NOT NULL DEFAULT 'change',
  source_commits TEXT NOT NULL DEFAULT '[]',
  commit_hash TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 1,
  confidence REAL,
  noise_score REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  introduced_in_commit TEXT,
  verified_until_commit TEXT,
  validity_status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'commit',
  content_hash TEXT
);
CREATE INDEX IF NOT EXISTS l3_nodes_l2_node_id_idx ON l3_nodes(l2_node_id);
CREATE INDEX IF NOT EXISTS l3_nodes_content_hash_idx ON l3_nodes(content_hash);

-- FTS5 keyword indexes for the local-first natural-language fallback (ADR-029),
-- ported from lib/core/src/services/sqlite-fts.ts. External-content indexes
-- over l2_nodes / l3_nodes, kept in sync by triggers so ordinary writes to the
-- content tables require no separate "ensure FTS" step.
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
