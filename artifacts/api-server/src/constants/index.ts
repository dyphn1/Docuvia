/**
 * api-server Core Constants and Definitions
 */

// ── Auth & Security Constants ──────────────────────────────────────
export const AUTH_BEARER_PREFIX = "Bearer ";
export const AUTH_BEARER_PREFIX_LEN = 7;
export const DEFAULT_USER_ID = 1;
export const ENV_API_KEY = "DOCUVIA_API_KEY";

// ── Rate Limiting Constants ─────────────────────────────────────────
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_STANDARD_MAX = 500;
export const RATE_LIMIT_MCP_MAX = 100;

// ── Job Queue Constants ─────────────────────────────────────────────
export const JOB_QUEUE_POLL_INTERVAL_MS = 5000;
export const JOB_QUEUE_STALL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const JOB_QUEUE_LIMIT = 5;

export const JOB_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export const JOB_TASK_TYPES = {
  SYNC_ORPHAN_BRANCH: "sync_orphan_branch",
  AST_INGEST: "ast_ingest",
  AST_INGEST_JOB: "ast_ingest_job",
} as const;

// ── AST Ingestion & Worker Constants ─────────────────────────────────
export const AST_INGESTION_DEFAULTS = {
  DEFAULT_PROJECT_ID: 1,
  DEFAULT_TIMEOUT_MS: 2000,
  TASK_TYPE_AST_PARSE: "ast_parse",
  TASK_TYPE_AST_POISON_PILL: "ast_parse_poison_pill",
  MAX_CONCURRENT_IN_FLIGHT: 100,
  TEMP_FILE_PREFIX_BRIDGE: "ast-bridge-",
  TEMP_FILE_PREFIX_SKELETON: "ast-skeleton-",
  TEMP_FILE_PREFIX_SINK: "ast-sink-",
  TEMP_FILE_EXT_JSONL: ".jsonl",
  OPENAPI_FORMAT_JSON: "json",
  OPENAPI_FORMAT_YAML: "yaml",
  EXTENSION_JSON: ".json",
  MSG_FILE_QUARANTINED: "File is quarantined",
  MSG_FILE_LIMIT_EXCEEDED: "File exceeds maximum size limit (10MB)",
  WRITE_STREAM_FLAG_APPEND: "a",
  EVENT_DRAIN: "drain",
  NEWLINE: "\n",
  DATA_DIR_NAME: "data",
  SQL_CREATE_TABLE: `
    CREATE TABLE IF NOT EXISTS quarantine_blacklist (
        file_path TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `,
  SQL_SELECT_QUARANTINE: "SELECT 1 FROM quarantine_blacklist WHERE file_path = ?",
  SQL_INSERT_QUARANTINE: "INSERT OR IGNORE INTO quarantine_blacklist (file_path) VALUES (?)",
} as const;

// ── Proxy & LLM Constants ───────────────────────────────────────────
export const PROXY_JSON_LIMIT = "50mb";
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
export const ANTHROPIC_VERSION_HEADER_KEY = "anthropic-version";
export const ANTHROPIC_VERSION_HEADER_VAL = "2023-06-01";

// ── Express Application Routes & Configurations ──────────────────────
export const EXPRESS_TRUST_PROXY_HOPS = 1;
export const ROUTE_WEBHOOKS_GITHUB = "/api/webhooks/github";
export const ROUTE_PROXY_V1 = "/proxy/v1";
export const ROUTE_API_PREFIX = "/api";
export const MIME_TYPE_JSON = "application/json";

// ── App Inits & Janitor Constants ────────────────────────────────────
export const ENV_PORT_KEY = "PORT";
export const STARTUP_JANITOR_DELAY_MS = 10000;
export const JANITOR_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ── Shared Memory & SQLite Engine Constants ──────────────────────────
export const SHARED_MEMORY_DEFAULTS = {
  DATA_DIR_NAME: "data",
  SQL_INIT_SCHEMA: `
    CREATE TABLE IF NOT EXISTS shared_agent_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_type TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS compressed_payloads (
        id TEXT PRIMARY KEY,
        original_text TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `,
  SQL_SELECT_QUARANTINE_STMT: "SELECT * FROM shared_agent_memory WHERE key = ?",
  SQL_SELECT_ALL_MEMORIES: "SELECT * FROM shared_agent_memory ORDER BY timestamp DESC",
  SQL_INSERT_MEMORY: "INSERT INTO shared_agent_memory (agent_type, key, content) VALUES (?, ?, ?)",
  SQL_INSERT_COMPRESSED_PAYLOAD:
    "INSERT INTO compressed_payloads (id, original_text) VALUES (?, ?)",
  SQL_SELECT_COMPRESSED_PAYLOAD: "SELECT original_text FROM compressed_payloads WHERE id = ?",
  SQL_DELETE_EXPIRED_PAYLOADS:
    "DELETE FROM compressed_payloads WHERE timestamp <= datetime('now', '-1 day')",
  SQL_MINE_PROXY_STATS:
    "SELECT count(*) as total, datetime(timestamp, 'start of hour') as hour FROM compressed_payloads GROUP BY hour ORDER BY hour DESC LIMIT 24",
  TTL_JOB_INTERVAL_MS: 60 * 60 * 1000, // 1 hour
  MINER_JOB_INTERVAL_MS: 60000, // 1 minute
  MINER_TRIGGER_THRESHOLD: 50,
  MINER_AGENT_TYPE: "miner",
  MINER_PROXY_STATS_KEY: "proxy_stats",
} as const;

// ── Prompt Compressor & LLM Context Rules ────────────────────────────
export const COMPRESSOR_DEFAULTS = {
  DUMB_CRUSHER_REPLACEMENT: "{ /* ... */ }",
  SKELETON_PREFIX_ID: "// [COMPRESSED_SKELETON_ID: ",
  SKELETON_SUFFIX_ID: "]\n",
  MD_CODE_FENCE_REGEX:
    /```[\w]*\s*(?:<!--\s*([^\n]+)\s*-->|(?:\/\/\s*|#\s*)([\w./-]+))?\s*\n([\s\S]*?)```/g,
  XML_FILE_TAG_REGEX: /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g,
  MIN_LENGTH_FOR_HEURISTIC: 5,
  HEURISTIC_FILE_LINES_LIMIT: 2,
  TYPE_MARKDOWN: "markdown",
  TYPE_XML: "xml",
  WASM_NOT_FOUND_FALLBACK_DIR: "node_modules",
  COMPRESSION_HEURISTIC_THRESHOLD_LINES: 30,
  PKG_TREE_SITTER_WASMS: "tree-sitter-wasms/package.json",
  PKG_JSON_FILE_NAME: "package.json",
  DIR_OUT: "out",
} as const;
