-- 0002_l2_node_key.sql
-- STOR-005: deterministic, path-keyed node identity, separate from the SQLite AUTOINCREMENT
-- rowid. `node_key` is `<file_path>` for file nodes and `<file_path>#<symbolName>` for
-- function/class nodes — stable across machines and across a clean + re-analyze cycle, so
-- `nodes.jsonl`/`edges.jsonl` exports produce clean, deterministic diffs instead of exporting
-- effectively-random rowids.

ALTER TABLE l2_nodes ADD COLUMN node_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS l2_nodes_project_id_node_key_idx ON l2_nodes(project_id, node_key);
