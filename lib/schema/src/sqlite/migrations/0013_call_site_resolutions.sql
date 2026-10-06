-- GRPH-008 Phase 3: current per-call-site resolution is authoritative. Candidate alternatives
-- are normalized, while observations live independently so reparsing current state never erases
-- prior resolver, strict-proof, hypothesis, or Tier B evidence.

CREATE TABLE IF NOT EXISTS call_site_resolutions (
  project_id INTEGER NOT NULL,
  call_site_key TEXT NOT NULL,
  identity_version INTEGER NOT NULL CHECK (identity_version = 1),
  file_path TEXT NOT NULL,
  source_content_hash TEXT NOT NULL CHECK (length(source_content_hash) = 64),
  start_line INTEGER NOT NULL CHECK (start_line >= 0),
  start_column INTEGER NOT NULL CHECK (start_column >= 0),
  callee_kind TEXT NOT NULL,
  callee_name TEXT NOT NULL,
  caller_node_key TEXT NOT NULL,
  resolution_class TEXT NOT NULL CHECK (resolution_class IN ('proven', 'likely', 'ambiguous', 'unresolved', 'external', 'unsupported')),
  selected_target_node_key TEXT,
  confidence REAL,
  resolver TEXT NOT NULL,
  rule_signature TEXT NOT NULL,
  dependency_fingerprint TEXT NOT NULL CHECK (length(dependency_fingerprint) = 64),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('unverified', 'verified', 'contradicted')),
  verified_target_node_key TEXT,
  is_stale INTEGER NOT NULL DEFAULT 0 CHECK (is_stale IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, call_site_key),
  CHECK (
    (resolution_class = 'likely' AND confidence IS NOT NULL AND confidence BETWEEN 0.0 AND 1.0)
    OR (resolution_class != 'likely' AND confidence IS NULL)
  ),
  CHECK (
    (resolution_class IN ('proven', 'likely') AND selected_target_node_key IS NOT NULL)
    OR (resolution_class NOT IN ('proven', 'likely') AND selected_target_node_key IS NULL)
  ),
  CHECK (
    (verification_status = 'unverified' AND verified_target_node_key IS NULL)
    OR (verification_status IN ('verified', 'contradicted') AND verified_target_node_key IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS call_site_resolutions_project_file_idx
  ON call_site_resolutions(project_id, file_path);

CREATE TABLE IF NOT EXISTS call_site_resolution_candidates (
  project_id INTEGER NOT NULL,
  call_site_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  target_node_key TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  PRIMARY KEY (project_id, call_site_key, ordinal),
  UNIQUE (project_id, call_site_key, target_node_key),
  FOREIGN KEY (project_id, call_site_key)
    REFERENCES call_site_resolutions(project_id, call_site_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS call_site_resolution_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  call_site_key TEXT NOT NULL,
  file_path TEXT NOT NULL,
  source_content_hash TEXT NOT NULL CHECK (length(source_content_hash) = 64),
  source TEXT NOT NULL CHECK (source IN ('scope-resolver', 'strict-proof', 'hypothesis', 'tier-b')),
  resolution_class TEXT CHECK (resolution_class IS NULL OR resolution_class IN ('proven', 'likely', 'ambiguous', 'unresolved', 'external', 'unsupported')),
  target_node_key TEXT,
  resolver TEXT,
  rule_signature TEXT,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS call_site_resolution_observations_project_file_idx
  ON call_site_resolution_observations(project_id, file_path, id);
