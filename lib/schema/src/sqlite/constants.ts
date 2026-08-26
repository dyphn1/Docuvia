/** SQLite connection defaults and pragma values to ensure single source of truth and DRY configuration. */
export const SQLiteConstants = {
  BUSY_TIMEOUT_MS: 10000,
  JOURNAL_MODE: "WAL",
  SYNCHRONOUS: "NORMAL",
  /** Suffix SQLite appends to `dbPath` for its Write-Ahead Log file in WAL mode (ADR-032). */
  WAL_FILE_SUFFIX: "-wal",
} as const;

/** SQLite's own `PRAGMA <name>` identifiers passed to `db.pragma(...)` — external pragma vocabulary, not project-defined. */
export const SqlitePragmaNames = {
  BUSY_TIMEOUT: "busy_timeout",
  JOURNAL_MODE: "journal_mode",
  SYNCHRONOUS: "synchronous",
  INTEGRITY_CHECK: "integrity_check",
} as const;

/**
 * Names of every table (and FTS5 virtual table) in the local SQLite schema (see
 * `sqlite/migrations/0001_init.sql` / `0003_docuvia_meta.sql`) — single source of truth for the
 * repo classes' raw SQL, so a typo'd table name is a compile-time (well, single-definition-site)
 * concern instead of a silently-wrong "no such table" bug repeated across call sites.
 */
export const SchemaTables = {
  PROJECTS: "projects",
  PROJECT_FILES: "project_files",
  L1_TAGS: "l1_tags",
  L2_NODES: "l2_nodes",
  L2_NODES_FTS: "l2_nodes_fts",
  L2_NODE_L1_TAGS: "l2_node_l1_tags",
  NODE_LINKS: "node_links",
  L3_NODES: "l3_nodes",
  L3_NODES_FTS: "l3_nodes_fts",
  DOCUVIA_META: "docuvia_meta",
  SCHEMA_MIGRATIONS: "schema_migrations",
  AST_CALL_SITES: "ast_call_sites",
} as const;

/**
 * Column names that recur verbatim across more than one raw SQL string in `lib/schema`'s repo
 * classes — the same duplication-typo risk as {@link SchemaTables}. Single-occurrence/generic
 * column names (`id`, `name`, `type`, ...) are left inline; they don't drift out of sync with
 * anything since there's only ever one spelling of them in this codebase.
 */
export const SchemaColumns = {
  PROJECT_ID: "project_id",
  FILE_PATH: "file_path",
  CONTENT_HASH: "content_hash",
  PATH_PATTERNS: "path_patterns",
  NODE_KEY: "node_key",
  SOURCE_NODE_ID: "source_node_id",
  TARGET_NODE_ID: "target_node_id",
  LINK_TYPE: "link_type",
  L2_NODE_ID: "l2_node_id",
  L1_TAG_ID: "l1_tag_id",
  FILENAME: "filename",
  TARGET_FUNCTION: "target_function",
  START_LINE: "start_line",
  START_COLUMN: "start_column",
  CALLEE_NAME: "callee_name",
  RECEIVER_TEXT: "receiver_text",
  CALLEE_KIND: "callee_kind",
} as const;
