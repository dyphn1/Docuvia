-- 0008_ast_call_sites.sql
-- issue #11 plan A, Slice 3 (docs/gitbook/analysis/forward-tier-b-edge-resolution-plan.md):
-- Tier A's ast-worker.ts computes each call site's source position (Slice 1) but never
-- persisted it -- this table is the missing read-back surface Tier B's forward resolution
-- pass seeds itself from. One row per call site (not one row per resolved edge -- unlike
-- node_links, a row here exists whether or not ScopeResolver could resolve the target
-- locally, since unresolved cross-file calls are exactly what Tier B needs to see).

CREATE TABLE IF NOT EXISTS ast_call_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  target_function TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  start_column INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ast_call_sites_project_file_idx ON ast_call_sites(project_id, file_path);
