-- 0011_ast_call_sites_target_idx.sql
-- issue #217: ImpactService's blast-radius fallback reverse-reads ast_call_sites by
-- target_function (the reverse of 0008's (project_id, file_path) access pattern, which only
-- Tier B's per-file forward resolution needed). Without this index that lookup is a full
-- table scan -- at vscode scale (882k+ rows, typescript-cli-benchmark.md) that is tens of
-- milliseconds on the one query path `impact` explicitly promised not to slow down.

CREATE INDEX IF NOT EXISTS ast_call_sites_project_target_idx ON ast_call_sites(project_id, target_function);
