-- GRPH-008 Phase 4: local runtime quarantine for a rule signature contradicted by one
-- source-bound, unique local Tier B definition. This table is intentionally omitted from
-- snapshot export/hydration; quarantine is workspace-local operational state, not portable truth.
CREATE TABLE IF NOT EXISTS call_site_rule_quarantines (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rule_signature TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason = 'tier-b-target-mismatch'),
  call_site_key TEXT NOT NULL,
  source_content_hash TEXT NOT NULL CHECK (length(source_content_hash) = 64),
  expected_target_node_key TEXT NOT NULL,
  observed_target_node_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, rule_signature)
);
