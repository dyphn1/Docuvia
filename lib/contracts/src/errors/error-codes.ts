/**
 * Registry of every known failure mode across the workspace — see
 * docs/gitbook/architecture/error-handling-architecture.md. Append new codes here as new
 * failure modes are discovered; never throw a raw third-party error across a layer boundary.
 */
export const ErrorCodes = {
  // Git (lib/git-local / lib/core/git)
  GIT_COMMAND_FAILED: "GIT_COMMAND_FAILED",
  GIT_NETWORK_TIMEOUT: "GIT_NETWORK_TIMEOUT",
  GIT_NOT_A_REPOSITORY: "GIT_NOT_A_REPOSITORY",
  GIT_BRANCH_CREATE_FAILED: "GIT_BRANCH_CREATE_FAILED",
  GIT_HOOK_INSTALL_FAILED: "GIT_HOOK_INSTALL_FAILED",
  GIT_FAST_IMPORT_FAILED: "GIT_FAST_IMPORT_FAILED",

  // Database / memory layer (lib/schema)
  DB_OPEN_FAILED: "DB_OPEN_FAILED",
  DB_NOT_FOUND: "DB_NOT_FOUND",
  DB_MIGRATION_FAILED: "DB_MIGRATION_FAILED",
  DB_QUERY_FAILED: "DB_QUERY_FAILED",
  DB_LOCKED: "DB_LOCKED",

  // AST processing (lib/core/ast)
  AST_WORKER_CRASHED: "AST_WORKER_CRASHED",
  AST_PARSE_FAILED: "AST_PARSE_FAILED",

  // File discovery / scanning (lib/core/discovery)
  FS_READ_FAILED: "FS_READ_FAILED",
  FS_PATH_TRAVERSAL: "FS_PATH_TRAVERSAL",

  // Virtual layer (lib/contracts) itself
  FACTORY_TOKEN_NOT_REGISTERED: "FACTORY_TOKEN_NOT_REGISTERED",
  FACTORY_LOCKED: "FACTORY_LOCKED",
  MEMORY_SCOPE_NOT_FOUND: "MEMORY_SCOPE_NOT_FOUND",

  // Remote sync client (lib/remote-api)
  SYNC_FETCH_FAILED: "SYNC_FETCH_FAILED",
  SYNC_PUSH_FAILED: "SYNC_PUSH_FAILED",

  // LLM client (lib/llm-api)
  LLM_NOT_INITIALIZED: "LLM_NOT_INITIALIZED",
  LLM_CHAT_COMPLETION_FAILED: "LLM_CHAT_COMPLETION_FAILED",
  LLM_STREAM_FAILED: "LLM_STREAM_FAILED",
  LLM_INVALID_RESPONSE: "LLM_INVALID_RESPONSE",

  // Orchestration (lib/ui-core)
  INIT_WORKFLOW_FAILED: "INIT_WORKFLOW_FAILED",
  CLEAN_WORKFLOW_FAILED: "CLEAN_WORKFLOW_FAILED",

  // Boundary validation (Presentation layer)
  INVALID_INPUT: "INVALID_INPUT",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
