-- Allow a unique Tier B result to select a target for an originally ambiguous, unresolved,
-- external, or unsupported site while retaining the original resolution class.
CREATE TEMP TABLE call_site_resolution_candidates_backup AS
SELECT * FROM call_site_resolution_candidates;
CREATE TEMP TABLE call_site_resolution_dependencies_backup AS
SELECT * FROM call_site_resolution_dependencies;
CREATE TEMP TABLE call_site_resolution_projection_callers_backup AS
SELECT * FROM call_site_resolution_projection_callers;

DROP TABLE call_site_resolution_candidates;
DROP TABLE call_site_resolution_dependencies;
DROP TABLE call_site_resolution_projection_callers;

CREATE TABLE call_site_resolutions_new (
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
    OR (
      resolution_class NOT IN ('proven', 'likely')
      AND (
        selected_target_node_key IS NULL
        OR (
          verification_status = 'verified'
          AND selected_target_node_key = verified_target_node_key
        )
      )
    )
  ),
  CHECK (
    (verification_status = 'unverified' AND verified_target_node_key IS NULL)
    OR (verification_status IN ('verified', 'contradicted') AND verified_target_node_key IS NOT NULL)
  )
);

INSERT INTO call_site_resolutions_new (
  project_id, call_site_key, identity_version, file_path, source_content_hash,
  start_line, start_column, callee_kind, callee_name, caller_node_key,
  resolution_class, selected_target_node_key, confidence, resolver, rule_signature,
  dependency_fingerprint, verification_status, verified_target_node_key, is_stale,
  updated_at
)
SELECT
  project_id, call_site_key, identity_version, file_path, source_content_hash,
  start_line, start_column, callee_kind, callee_name, caller_node_key,
  resolution_class, selected_target_node_key, confidence, resolver, rule_signature,
  dependency_fingerprint, verification_status, verified_target_node_key, is_stale,
  updated_at
FROM call_site_resolutions;

DROP TABLE call_site_resolutions;
ALTER TABLE call_site_resolutions_new RENAME TO call_site_resolutions;
CREATE INDEX call_site_resolutions_project_file_idx
  ON call_site_resolutions(project_id, file_path);

CREATE TABLE call_site_resolution_candidates (
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
INSERT INTO call_site_resolution_candidates SELECT * FROM call_site_resolution_candidates_backup;

CREATE TABLE call_site_resolution_dependencies (
  project_id INTEGER NOT NULL,
  call_site_key TEXT NOT NULL,
  dependency_path TEXT NOT NULL,
  content_hash TEXT CHECK (content_hash IS NULL OR length(content_hash) = 64),
  PRIMARY KEY (project_id, call_site_key, dependency_path),
  FOREIGN KEY (project_id, call_site_key)
    REFERENCES call_site_resolutions(project_id, call_site_key) ON DELETE CASCADE
);
CREATE INDEX call_site_resolution_dependencies_path_idx
  ON call_site_resolution_dependencies(project_id, dependency_path, content_hash);
INSERT INTO call_site_resolution_dependencies SELECT * FROM call_site_resolution_dependencies_backup;

CREATE TABLE call_site_resolution_projection_callers (
  project_id INTEGER NOT NULL,
  call_site_key TEXT NOT NULL,
  caller_node_key TEXT NOT NULL,
  PRIMARY KEY (project_id, call_site_key),
  FOREIGN KEY (project_id, call_site_key)
    REFERENCES call_site_resolutions(project_id, call_site_key) ON DELETE CASCADE
);
INSERT INTO call_site_resolution_projection_callers
SELECT * FROM call_site_resolution_projection_callers_backup;

DROP TABLE call_site_resolution_candidates_backup;
DROP TABLE call_site_resolution_dependencies_backup;
DROP TABLE call_site_resolution_projection_callers_backup;
