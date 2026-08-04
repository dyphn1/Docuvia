-- 0006_tier_b_file_status.sql
-- docs/cli-test-analysis/typescript-cli-benchmark.md §5.3/§5.7 items 1-2 (Tier B full-resync gap):
-- `project_files` already tracks each file's last Tier A parse (`last_parsed_at`); this adds the
-- Tier B analogue so `query`/`impact` can distinguish "this file's calls have never been computed
-- by Tier B" from "confirmed zero calls". Additive `ALTER TABLE ... ADD COLUMN` only, matching
-- 0004/0005's precedent -- pre-existing rows keep NULL, which is exactly "never processed" (there
-- is no historical record to backfill: no per-file Tier B timestamp existed before this migration).

ALTER TABLE project_files ADD COLUMN last_tier_b_processed_at TEXT;
ALTER TABLE project_files ADD COLUMN last_tier_b_commit_sha TEXT;
