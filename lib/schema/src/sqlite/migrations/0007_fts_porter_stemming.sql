-- 0007_fts_porter_stemming.sql
-- docs/gitbook/analysis/roadmap-and-open-items.md item 25 ("query"'s FTS ranking has no
-- synonym/token-expansion step): the default FTS5 tokenizer (unicode61) does exact token
-- matching with no stemming, so a directory named "commands" (plural) and a query keyword
-- "command" (singular) are two different tokens that never match each other -- confirmed against
-- this repo's own data: `"query" AND "command"` matched 0 l2_nodes rows even though
-- artifacts/cli/src/commands/query.ts obviously matches both concepts. Switching to
-- tokenize='porter unicode61' folds English plurals/suffixes to a common stem
-- ("commands"/"command" -> "command", "query"/"queries" -> "queri") at both index and query time
-- (SQLite applies a table's configured tokenizer to MATCH text too), closing that gap with no
-- application-code change to how queries are issued.
--
-- FTS5 virtual tables can't ALTER their tokenizer in place -- drop and recreate, then rebuild the
-- index from the existing content tables (l2_nodes/l3_nodes), exactly like `withFtsSyncSuspended`
-- already does for bulk loads (graph-repo.ts). The AFTER INSERT/DELETE/UPDATE triggers live on
-- l2_nodes/l3_nodes (not on the virtual tables) and reference l2_nodes_fts/l3_nodes_fts only by
-- name in their body, so they keep working unchanged once the virtual tables are recreated below.

DROP TABLE IF EXISTS l2_nodes_fts;
CREATE VIRTUAL TABLE l2_nodes_fts USING fts5(
  name, description, path_patterns,
  content='l2_nodes', content_rowid='id',
  tokenize='porter unicode61'
);
INSERT INTO l2_nodes_fts(l2_nodes_fts) VALUES('rebuild');

DROP TABLE IF EXISTS l3_nodes_fts;
CREATE VIRTUAL TABLE l3_nodes_fts USING fts5(
  title, content,
  content='l3_nodes', content_rowid='id',
  tokenize='porter unicode61'
);
INSERT INTO l3_nodes_fts(l3_nodes_fts) VALUES('rebuild');
