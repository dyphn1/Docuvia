-- Issue #192 (root-cause fix, phase 1 "extractor surgery"): `target_function` stores the raw
-- callee expression text (`service.doSomething`, `vi.fn().mockResolvedValue`), which
-- ScopeResolver's bare-name model could never match -- the single largest cause of the ~12.8%
-- distinct-target resolution rate. These columns decompose that evidence without changing the
-- raw column's semantics (Tier B seeding uses positions, not the string; #217's impact fallback
-- matches target_function and gains an OR-match on callee_name):
--
--   callee_name   — the terminal callee identifier (`doSomething`), what bare-name resolution
--                   actually needs. NULL for pre-migration rows and for shapes with no clean
--                   terminal identifier.
--   receiver_text — the receiver expression text (`service`, `this.logger`) kept as evidence for
--                   import-binding receiver resolution and future receiver-type work. NULL for
--                   bare calls.
--   callee_kind   — shape classifier: 'bare' | 'member' | 'this' | 'arg-chain' | 'computed'.
--                   'arg-chain' (receiver is itself an invocation result, e.g.
--                   `expect(x).toEqual`) and 'computed' (`obj[expr]()`) are structurally
--                   unresolvable by name matching, so the health-rate denominators exclude them
--                   instead of counting them as failures. NULL = unknown (pre-migration row).
--
-- No backfill: persist is delete-then-reinsert per file on reparse, so a full re-analysis
-- repopulates all rows under the new semantics.

ALTER TABLE ast_call_sites ADD COLUMN callee_name TEXT;
ALTER TABLE ast_call_sites ADD COLUMN receiver_text TEXT;
ALTER TABLE ast_call_sites ADD COLUMN callee_kind TEXT;

CREATE INDEX IF NOT EXISTS ast_call_sites_callee_name_idx
  ON ast_call_sites(project_id, callee_name);
