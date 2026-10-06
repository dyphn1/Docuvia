-- Keep the ScopeResolver caller used by the calls graph projection separate from the exact
-- enclosing caller identity recorded in call_site_resolutions.caller_node_key.
CREATE TABLE IF NOT EXISTS call_site_resolution_projection_callers (
  project_id INTEGER NOT NULL,
  call_site_key TEXT NOT NULL,
  caller_node_key TEXT NOT NULL,
  PRIMARY KEY (project_id, call_site_key),
  FOREIGN KEY (project_id, call_site_key)
    REFERENCES call_site_resolutions(project_id, call_site_key) ON DELETE CASCADE
);
