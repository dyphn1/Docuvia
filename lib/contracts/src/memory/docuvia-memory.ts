import { DocuviaError } from "../errors/docuvia-error.js";
import { ErrorCodes } from "../errors/error-codes.js";

/**
 * Valid keys for the UUID-scoped runtime configuration store.
 * Prevents magic-string typing errors across layers.
 */
export const MemoryKeys = {
  WORKSPACE_ROOT: "workspaceRoot",
  API_URL: "apiUrl",
  PAT: "pat",
  PROJECT_ID: "projectId",
  COMMIT_SHA: "commitSha",
  TARGET_PATH: "targetPath",
  LLM_BASE_URL: "llmBaseUrl",
  LLM_MODEL: "llmModel",
  LLM_API_KEY: "llmApiKey",
  BASE_REF: "baseRef",
  TARGET: "target",
  ESCALATE_TO_LSP: "escalateToLsp",
  /** `analyze --escalate-to-lsp --full` (typescript-cli-benchmark.md §5.3/§5.7 item 1) -- pre-
   *  populates `tierBQueue` with every currently-tracked file before the batch drains it. Ignored
   *  outside `ESCALATE_TO_LSP`. */
  TIER_B_FULL_RESYNC: "tierBFullResync",
  LIMIT: "limit",
  COLLAPSE: "collapse",
  /** `uninstall --keep-db` — when set, skips local.db deletion, whole-`.docuvia/`-dir removal,
   *  and the `docuvia-knowledge` branch delete (all three are the same underlying graph, just in
   *  three storage forms — STOR-001/STOR-002 — so "keep my data" means keeping all three). */
  KEEP_DB: "keepDb",
  /** §8b "config-overridable" LSP binary path — absolute path or bare command on PATH. */
  LSP_BINARY_OVERRIDE: "lspBinaryOverride",
  /** §8b "config-overridable" LSP binary args (space-separated in the env var, split by the CLI layer). */
  LSP_ARGS_OVERRIDE: "lspArgsOverride",
  /** §8h "generous initial timeout" override, in milliseconds. */
  LSP_TIMEOUT_MS: "lspTimeoutMs",
  /** Tier B multi-process sharding override — how many independent LSP server processes to
   *  shard the Tier B batch across (see `EdgeResolutionProviderConfig.maxProcesses`). */
  LSP_MAX_PROCESSES: "lspMaxProcesses",
  /** §8f commit-cap override (default 20, config-tunable). */
  TIER_B_COMMIT_CAP: "tierBCommitCap",
  /** §9f Tier C daily call-budget override. */
  TIER_C_DAILY_CALL_CAP: "tierCDailyCallCap",
  /** §9f Tier C daily token-budget override (estimated, per `estimateTokenCount`). */
  TIER_C_DAILY_TOKEN_CAP: "tierCDailyTokenCap",
  /** §9d Tier C per-run wall-clock cap override, in milliseconds. */
  TIER_C_WALL_CLOCK_MS: "tierCWallClockMs",
  /** §9d Tier C per-run item-count cap override (whichever of the two caps binds first). */
  TIER_C_ITEM_CAP: "tierCItemCap",
  /** §9f Tier C system-load-check threshold override (`loadavg[0] / cpus > threshold`). */
  TIER_C_LOAD_THRESHOLD: "tierCLoadThreshold",
  /** `sync-knowledge`'s git fetch/push network timeout override, in milliseconds
   *  (`DOCUVIA_PUSH_TIMEOUT_MS`). `undefined` (unset) is the default and means "no timeout — wait
   *  for the transfer to finish, however long that takes" (found via dogfooding: a real
   *  `sync-knowledge` push on Docuvia2 routinely exceeds 60s, so a fixed bound cut off healthy
   *  pushes, not just hung ones). */
  GIT_NETWORK_TIMEOUT_MS: "gitNetworkTimeoutMs",
  /** Manual force override. */
  FORCE: "force",
  /** The already-parsed `{title, content, nodeType, confidence}[]` payload for
   *  `--agent-authored` mode -- boundary-validated by the CLI layer (zod) before this is set. */
  AGENT_AUTHORED_DECISIONS: "agentAuthoredDecisions",
  /** `docuvia hooks enable/disable <hookName>` -- the `HookName` being toggled. */
  HOOK_NAME: "hookName",
  /** `docuvia hooks enable/disable <hookName>` -- the boolean to persist for `HOOK_NAME`. */
  HOOK_ENABLED: "hookEnabled",
  /** `analyze --flush-staged-l3` (issue #42, Decision 2's two-stage stage-and-flush design §8.2)
   *  -- when set, `docuviaApi.analyze()` dispatches `AnalyzeWorkflow`'s flush mode instead of any
   *  of `targetPath`/`agentAuthoredDecisions`/`escalateToLsp` (none of which this mode sets). */
  FLUSH_STAGED_L3: "flushStagedL3",
} as const;

export type MemoryKey = (typeof MemoryKeys)[keyof typeof MemoryKeys];

const MemoryErrorMessages = {
  SCOPE_NOT_FOUND: (key: MemoryKey, scopeId: string) =>
    `Cannot set "${key}": memory scope "${scopeId}" was never created`,
} as const;

/**
 * UUID-scoped runtime configuration store — see
 * docs/gitbook/architecture/application-lifecycle-and-state.md. The *only* source of truth
 * for runtime configuration (workspace paths, log level, feature flags, ...). Implementation
 * libraries read exclusively from here (never `process.env`); the Presentation layer creates a
 * scope per invocation and is responsible for deleting it when the run completes (Garbage
 * Collection), preventing OOM leaks in long-running hosts like an MCP server.
 */
export class DocuviaMemory {
  private readonly scopes = new Map<string, Map<string, unknown>>();

  /** Creates an empty scope for `scopeId` (no-op if it already exists). */
  createScope(scopeId: string): void {
    if (!this.scopes.has(scopeId)) this.scopes.set(scopeId, new Map());
  }

  set<T>(scopeId: string, key: MemoryKey, value: T): void {
    const scope = this.scopes.get(scopeId);
    if (!scope) {
      throw new DocuviaError(
        ErrorCodes.MEMORY_SCOPE_NOT_FOUND,
        MemoryErrorMessages.SCOPE_NOT_FOUND(key, scopeId),
      );
    }
    scope.set(key, value);
  }

  get<T>(scopeId: string, key: MemoryKey): T | undefined {
    return this.scopes.get(scopeId)?.get(key) as T | undefined;
  }

  /** Deletes the entire scope. Must be called by the Presentation layer once a run is complete. */
  deleteScope(scopeId: string): void {
    this.scopes.delete(scopeId);
  }

  hasScope(scopeId: string): boolean {
    return this.scopes.has(scopeId);
  }
}

export const docuviaMemory = new DocuviaMemory();
