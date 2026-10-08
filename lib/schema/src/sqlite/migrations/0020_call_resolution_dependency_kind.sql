-- Candidate-member lookups span beyond source-file dependencies. Keep them in the same durable
-- dependency index while allowing a file path and member name to share the same key text.
CREATE TABLE call_site_resolution_dependencies_new (
  project_id INTEGER NOT NULL,
  call_site_key TEXT NOT NULL,
  dependency_kind TEXT NOT NULL DEFAULT 'file'
    CHECK (dependency_kind IN ('file', 'candidate-member')),
  dependency_path TEXT NOT NULL,
  content_hash TEXT CHECK (content_hash IS NULL OR length(content_hash) = 64),
  PRIMARY KEY (project_id, call_site_key, dependency_kind, dependency_path),
  FOREIGN KEY (project_id, call_site_key)
    REFERENCES call_site_resolutions(project_id, call_site_key) ON DELETE CASCADE
);
INSERT INTO call_site_resolution_dependencies_new (
  project_id, call_site_key, dependency_kind, dependency_path, content_hash
)
SELECT project_id, call_site_key, 'file', dependency_path, content_hash
FROM call_site_resolution_dependencies;
DROP TABLE call_site_resolution_dependencies;
ALTER TABLE call_site_resolution_dependencies_new
  RENAME TO call_site_resolution_dependencies;
CREATE INDEX call_site_resolution_dependencies_path_idx
  ON call_site_resolution_dependencies(
    project_id, dependency_kind, dependency_path, content_hash
  );
