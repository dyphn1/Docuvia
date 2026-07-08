CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',
  vcs_type TEXT DEFAULT 'git',
  svn_url TEXT,
  last_git_ingested_at TEXT,
  last_svn_revision INTEGER,
  last_ast_ingested_at TEXT,
  owner_id INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS project_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  file_path TEXT,
  content_hash TEXT,
  last_parsed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, file_path)
);
CREATE TABLE IF NOT EXISTS l1_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  slug TEXT,
  category TEXT DEFAULT 'Feature',
  is_anchored INTEGER DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS l2_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  name TEXT,
  type TEXT DEFAULT 'module',
  is_system INTEGER DEFAULT 0,
  description TEXT,
  ai_generated INTEGER DEFAULT 1,
  needs_review INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
  path_patterns TEXT,
  reindex_required INTEGER DEFAULT 0,
  is_bootstrap_confirmed INTEGER DEFAULT 0,
  content_hash TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS node_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_node_id INTEGER,
  target_node_id INTEGER,
  link_type TEXT,
  commit_sha TEXT,
  diff_summary TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS l2_node_l1_tags (
  l2_node_id INTEGER,
  l1_tag_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS l3_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  l2_node_id INTEGER,
  title TEXT,
  content TEXT,
  node_type TEXT DEFAULT 'change',
  source_commits TEXT DEFAULT '[]',
  commit_hash TEXT,
  ai_generated INTEGER DEFAULT 1,
  confidence REAL,
  noise_score REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
  occurrence_count INTEGER DEFAULT 1,
  introduced_in_commit TEXT,
  verified_until_commit TEXT,
  validity_status TEXT DEFAULT 'pending',
  source TEXT DEFAULT 'commit',
  content_hash TEXT
);
