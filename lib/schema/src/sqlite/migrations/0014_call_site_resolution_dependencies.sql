-- GRPH-008 Phase 3: remember the file inputs behind each current resolution fingerprint so a
-- changed caller, import, re-export, config, declaration, or shared index invalidates dependents.

CREATE TABLE IF NOT EXISTS call_site_resolution_dependencies (
  project_id INTEGER NOT NULL,
  call_site_key TEXT NOT NULL,
  dependency_path TEXT NOT NULL,
  content_hash TEXT CHECK (content_hash IS NULL OR length(content_hash) = 64),
  PRIMARY KEY (project_id, call_site_key, dependency_path),
  FOREIGN KEY (project_id, call_site_key)
    REFERENCES call_site_resolutions(project_id, call_site_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS call_site_resolution_dependencies_path_idx
  ON call_site_resolution_dependencies(project_id, dependency_path, content_hash);
