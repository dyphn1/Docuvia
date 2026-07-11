/** Name of the hidden directory holding all local Docuvia state (SQLite db, temp files, exports). */
export const DOCUVIA_DIR_NAME = ".docuvia";
export const SHARED_AGENT_MEMORY_DB_NAME = "shared_agent_memory.db";
export const AST_QUARANTINE_DB_NAME = "ast_quarantine.db";

/** Directory (relative to `DOCUVIA_DIR_NAME`) holding persisted, AI-inspectable run logs. */
export const DOCUVIA_LOGS_DIR_NAME = "logs";
export const INIT_LOG_FILE_NAME = "init.log";
export const ANALYZE_LOG_FILE_NAME = "analyze.log";
export const STATUS_LOG_FILE_NAME = "status.log";
export const CLEAN_LOG_FILE_NAME = "clean.log";
export const REVIEW_LOG_FILE_NAME = "review.log";
export const SYNC_LOG_FILE_NAME = "sync.log";
export const SNAPSHOT_LOG_FILE_NAME = "snapshot.log";
export const QUERY_LOG_FILE_NAME = "query.log";
export const EXPORT_TOPOLOGY_LOG_FILE_NAME = "export-topology.log";

export const FILE_README = "README.md";
export const FILE_PACKAGE_JSON = "package.json";
export const FILE_GLOBAL_CONFIG_YAML = "config.yaml";
export const FILE_LOCAL_CONFIG_JSON = "config.json";

export const DEFAULT_SERVER_URL = "http://localhost:3000";
export const DEFAULT_PROJECT_ID = "1";

export const DIR_L3_DECISIONS = "l3_decisions";

/**
 * Files at/above this size are skipped during discovery rather than fully read and
 * handed to a parse worker. Matches GitNexus's documented oversized-file threshold,
 * so file-count comparisons between the two tools are apples-to-apples.
 */
export const MAX_FILE_SIZE_BYTES = 512_000;
