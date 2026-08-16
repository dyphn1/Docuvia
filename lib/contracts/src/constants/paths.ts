/**
 * Workspace-layout conventions shared across every layer (Presentation resolves paths from
 * these, `lib/ui-core` writes run logs against them, `lib/core`'s command-log-writer — wait,
 * see `lib/ui-core/src/utils/command-log-writer.ts` — reads them too). Zero logic, just the
 * shared naming convention every layer must agree on, per design-spirit.md's "Centralized
 * Constants" rule.
 */

/** Name of the hidden directory holding all local Docuvia state (SQLite db, temp files, run logs). */
export const DOCUVIA_DIR_NAME = ".docuvia";

/** Directory (relative to `DOCUVIA_DIR_NAME`) holding persisted, AI-inspectable run logs. */
export const DOCUVIA_LOGS_DIR_NAME = "logs";

export const INIT_LOG_FILE_NAME = "init.log";
export const CLEAN_LOG_FILE_NAME = "clean.log";
export const STATUS_LOG_FILE_NAME = "status.log";
export const SYNC_LOG_FILE_NAME = "sync.log";
export const ANALYZE_LOG_FILE_NAME = "analyze.log";
export const REVIEW_LOG_FILE_NAME = "review.log";
export const IMPACT_LOG_FILE_NAME = "impact.log";
export const QUERY_LOG_FILE_NAME = "query.log";
export const EXPORT_TOPOLOGY_LOG_FILE_NAME = "export-topology.log";
export const SNAPSHOT_LOG_FILE_NAME = "snapshot.log";
export const HYDRATE_LOG_FILE_NAME = "hydrate.log";
export const SYNC_KNOWLEDGE_LOG_FILE_NAME = "sync-knowledge.log";

/** Dependency-install directory name every scan in this package excludes, whether via a glob
 *  ignore pattern (`COMMON_GLOB_IGNORE_PATTERNS`) or a plain substring check
 *  (`FileDiscoveryService`) — moved here from `lib/core` (issue #93) so upper layers share it
 *  without a `lib/core` dependency. */
export const NODE_MODULES_DIR_NAME = "node_modules";

/** Filename (relative to `DOCUVIA_DIR_NAME`) of the local SQLite database. */
export const LOCAL_DB_FILE_NAME = "local.db";

/** Filename (relative to `DOCUVIA_DIR_NAME`) of the whole-`init`-command single-flight lockfile (PLAT-006). */
export const INIT_COMMAND_LOCK_FILE_NAME = "init.lock";

/** Filename (relative to `DOCUVIA_DIR_NAME`) of the Tier C drain's single-flight lockfile
 *  (phase1-decision-integration.md §9f, PLAT-006 pattern) — held for the whole dispatch window
 *  of `analyze --escalate-to-lsp`'s Tier C queue drain. */
export const TIER_C_LOCK_FILE_NAME = "tierC.lock";

/** Filename (relative to `DOCUVIA_DIR_NAME/DOCUVIA_LOGS_DIR_NAME`) of the `sync` content-hash dedup cache. */
export const SYNC_STATE_FILE_NAME = "sync-state.json";

/** Filename (relative to `DOCUVIA_DIR_NAME`) of the `docuvia hooks list/enable/disable`
 *  persistence file (issue #42, roadmap items 32-34 §7.1) -- a flat JSON `HooksConfig` map, read
 *  by both the compiled CLI and the raw `.claude/hooks/docuvia-hook.js` script (plain
 *  `fs.readFileSync` + `JSON.parse`, no subprocess). See `hooks.interfaces.ts`'s doc comment. */
export const HOOKS_CONFIG_FILE_NAME = "hooks-config.json";

/** Filename (relative to `DOCUVIA_DIR_NAME`) of `commit-l3-write`'s staging file (issue #42,
 *  Decision 2's two-stage stage-and-flush design §8.1) -- `analyze <targetPath> --agent-authored
 *  --stage` appends here instead of writing straight to `l3_nodes`; the post-commit hook's
 *  `analyze --flush-staged-l3` step drains entries whose `filePath` is in the triggering commit's
 *  changed-file list. */
export const PENDING_L3_DECISIONS_FILE_NAME = "pending-l3-decisions.json";

/**
 * Files at/above this size are skipped during discovery rather than fully read and handed to a
 * parse worker (shared by `lib/core`'s `file-discovery.service.ts` and `lib/ui-core`'s delta
 * ingestion oversize check). Matches GitNexus's documented oversized-file threshold, so
 * file-count comparisons between the two tools are apples-to-apples.
 */
export const MAX_FILE_SIZE_BYTES = 512_000;
