-- 0005_l3_initial_source_commits.sql
-- phase2-l3-distribution.md L3DIST-002/003: `snapshot`'s L3 card renderer packs a JSON snapshot
-- of `source_commits` frozen at the row's first insert, never the current (mutable, growing on
-- every re-analysis) `source_commits` value -- otherwise re-running `snapshot` with no new
-- decision content would still produce a different git blob every time occurrence tracking
-- appended a commit sha, defeating the idempotency §5b relies on. `ALTER TABLE ... ADD COLUMN`
-- only -- no table rebuild, no backfill (pre-existing rows keep NULL; the L3 card renderer falls
-- back to `source_commits` for those).

ALTER TABLE l3_nodes ADD COLUMN initial_source_commits TEXT;
