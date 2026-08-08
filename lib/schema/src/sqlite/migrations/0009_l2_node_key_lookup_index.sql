-- 0009_l2_node_key_lookup_index.sql
-- IMPT/perf: `findNodeIdByNodeKey`/Tier B edge application resolves an l2_node by its STOR-005
-- `node_key` alone (`SELECT id FROM l2_nodes WHERE node_key = ?`) -- a query SQLite cannot satisfy
-- with the existing composite `(project_id, node_key)` unique index, whose leading column makes
-- every such lookup a full covering-index SCAN over every row in the table. On a large repo
-- (vscode: ~293k nodes) that made `applyResolvedEdges` insert edges at ~20/sec during an
-- uncapped `--lsp-timeout=0` batch. A standalone single-column `node_key` index turns the lookup
-- into a SEARCH. Redundant with (not a replacement for) the composite unique index -- keys stay
-- unique *per project*, the composite still enforces that; this index is purely the lookup
-- accelerator.

CREATE INDEX IF NOT EXISTS l2_nodes_node_key_idx ON l2_nodes(node_key);