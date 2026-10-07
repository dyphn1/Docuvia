-- Capture the rule configuration active when a signature is first quarantined. Existing rows
-- remain readable with NULL and cannot be cleared until their historical configuration is known.
ALTER TABLE call_site_rule_quarantines
  ADD COLUMN rule_configuration_sha256 TEXT
  CHECK (
    rule_configuration_sha256 IS NULL
    OR (length(rule_configuration_sha256) = 64 AND rule_configuration_sha256 NOT GLOB '*[^a-f0-9]*')
  );

-- Clear records are immutable history and deliberately do not reference the active quarantine
-- row: clearing deletes that row so a later contradiction can create a fresh quarantine.
CREATE TABLE IF NOT EXISTS call_site_rule_quarantine_clear_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rule_signature TEXT NOT NULL,
  quarantine_policy_version TEXT NOT NULL,
  quarantine_reason TEXT NOT NULL CHECK (quarantine_reason = 'tier-b-target-mismatch'),
  quarantine_call_site_key TEXT NOT NULL,
  quarantine_source_content_hash TEXT NOT NULL CHECK (length(quarantine_source_content_hash) = 64),
  expected_target_node_key TEXT NOT NULL,
  observed_target_node_key TEXT NOT NULL,
  quarantine_created_at TEXT NOT NULL,
  cleared_at TEXT NOT NULL,
  clear_method TEXT NOT NULL CHECK (clear_method IN ('certification', 'operator')),
  evidence_sha256 TEXT CHECK (
    evidence_sha256 IS NULL
    OR (length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^a-f0-9]*')
  ),
  operator TEXT,
  reason TEXT,
  previous_rule_configuration_sha256 TEXT NOT NULL CHECK (
    length(previous_rule_configuration_sha256) = 64 AND previous_rule_configuration_sha256 NOT GLOB '*[^a-f0-9]*'
  ),
  new_rule_configuration_sha256 TEXT NOT NULL CHECK (
    length(new_rule_configuration_sha256) = 64 AND new_rule_configuration_sha256 NOT GLOB '*[^a-f0-9]*'
  ),
  CHECK (
    (clear_method = 'certification' AND evidence_sha256 IS NOT NULL AND operator IS NULL AND reason IS NULL)
    OR
    (clear_method = 'operator' AND evidence_sha256 IS NULL AND operator IS NOT NULL AND reason IS NOT NULL AND length(trim(operator)) > 0 AND length(trim(reason)) > 0)
  )
);

CREATE INDEX call_site_rule_quarantine_clear_audits_project_signature_idx
  ON call_site_rule_quarantine_clear_audits(project_id, rule_signature, id DESC);
