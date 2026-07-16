-- 0004_l3_provenance.sql
-- phase1-decision-integration.md §3a / PLAT-007 Tier C point 1: `analyze <targetPath>`'s LLM
-- decision-extraction results are persisted to `l3_nodes` instead of print-only. Two additive
-- provenance columns beyond what 0001_init.sql already carries (commit_hash, source_commits,
-- confidence, content_hash, validity_status, source): the extraction model and the source file
-- list. `ALTER TABLE ... ADD COLUMN` only -- no table rebuild, no backfill (pre-existing rows
-- keep NULL for both).

ALTER TABLE l3_nodes ADD COLUMN extraction_model TEXT;
-- JSON array of workspace-relative source file paths the decision was extracted from.
ALTER TABLE l3_nodes ADD COLUMN source_files TEXT;
