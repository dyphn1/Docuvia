import {
  docuviaMemory,
  DocuviaError,
  ErrorCodes,
  MemoryKeys,
  type ILogger,
  type MemoryKey,
  type EdgeResolutionProviderConfig,
  type EdgeResolutionAvailability,
} from "@workspace/contracts";
import fs from "fs";
import path from "path";
import { DOCUVIA_API_MESSAGES } from "./constants/docuvia-api-messages.js";
import { InitWorkflow } from "./workflows/init/init-workflow.js";
import type { InitResult } from "./workflows/init/init-result.js";
import { CleanWorkflow } from "./workflows/clean/clean-workflow.js";
import type { CleanResult } from "./workflows/clean/clean-result.js";
import { StatusWorkflow } from "./workflows/status/status-workflow.js";
import type { StatusResult } from "./workflows/status/status-result.js";
import { SyncWorkflow } from "./workflows/sync/sync-workflow.js";
import type { SyncResult } from "./workflows/sync/sync-result.js";
import { AnalyzeWorkflow } from "./workflows/analyze/analyze-workflow.js";
import type {
  AnalyzeResult,
  ExtractedDecision,
} from "./workflows/analyze/analyze-result.js";
import { ReviewWorkflow } from "./workflows/review/review-workflow.js";
import type { ReviewResult } from "./workflows/review/review-result.js";
import { ImpactWorkflow } from "./workflows/impact/impact-workflow.js";
import type { ImpactResult } from "./workflows/impact/impact-result.js";
import { QueryWorkflow } from "./workflows/query/query-workflow.js";
import type { QueryResult } from "./workflows/query/query-result.js";
import { ExportTopologyWorkflow } from "./workflows/export-topology/export-topology-workflow.js";
import type {
  TopologyExportOptions,
  TopologyGraph,
} from "@workspace/contracts";
import { SnapshotWorkflow } from "./workflows/snapshot/snapshot-workflow.js";
import type { SnapshotResult } from "./workflows/snapshot/snapshot-result.js";
import { HydrateWorkflow } from "./workflows/hydrate/hydrate-workflow.js";
import type { HydrateResult } from "./workflows/hydrate/hydrate-result.js";
import { SyncKnowledgeWorkflow } from "./workflows/sync-knowledge/sync-knowledge-workflow.js";
import type { KnowledgeBranchSyncResult } from "@workspace/contracts";
import {
  DoctorWorkflow,
  type DoctorOptions,
} from "./workflows/doctor/doctor-workflow.js";
import { checkTierBGate } from "./workflows/analyze/tier-b-gate.js";
import type { DoctorResult } from "./workflows/doctor/doctor-result.js";
import { UninstallHooksWorkflow } from "./workflows/uninstall/uninstall-hooks-workflow.js";
import { removeDocuviaDataDir } from "./workflows/uninstall/remove-docuvia-dir.js";
import {
  listHooks as listHooksWorkflow,
  setHookEnabled as setHookEnabledWorkflow,
} from "./workflows/hooks/hooks-workflow.js";
import type { HookName, HooksConfig } from "@workspace/contracts";
import { stagePendingDecisions } from "./workflows/analyze/pending-l3-decisions-store.js";
import { ANALYZE_MESSAGES } from "./workflows/analyze/analyze-messages.js";

function requireMemory<T>(scopeId: string, key: MemoryKey): T {
  const value = docuviaMemory.get<T>(scopeId, key);
  if (value === undefined) {
    throw new DocuviaError(
      ErrorCodes.INVALID_INPUT,
      DOCUVIA_API_MESSAGES.MISSING_MEMORY_KEY(key, scopeId),
    );
  }
  return value;
}

/** `analyze --escalate-to-lsp`'s §8b "config-overridable" LSP binary/args/timeout, read from
 *  `docuviaMemory` (never `process.env` directly -- the Presentation layer already did that
 *  translation). `undefined` when none of the three were set, so
 *  `TypescriptLspEdgeProvider.configure()` is skipped entirely and its own defaults apply. */
function buildLspProviderConfig(
  scopeId: string,
): EdgeResolutionProviderConfig | undefined {
  const binaryOverride = docuviaMemory.get<string>(
    scopeId,
    MemoryKeys.LSP_BINARY_OVERRIDE,
  );
  const argsOverride = docuviaMemory.get<string[]>(
    scopeId,
    MemoryKeys.LSP_ARGS_OVERRIDE,
  );
  const timeoutMs = docuviaMemory.get<number>(
    scopeId,
    MemoryKeys.LSP_TIMEOUT_MS,
  );
  const maxProcesses = docuviaMemory.get<number>(
    scopeId,
    MemoryKeys.LSP_MAX_PROCESSES,
  );

  if (
    binaryOverride === undefined &&
    argsOverride === undefined &&
    timeoutMs === undefined &&
    maxProcesses === undefined
  ) {
    return undefined;
  }
  return { binaryOverride, argsOverride, timeoutMs, maxProcesses };
}

/**
 * The unified `docuviaApi` — the only surface `artifacts/cli`/`mcp` call (see
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Orchestration Layer). Callers
 * must have already created a `docuviaMemory` scope for `scopeId` and set `workspaceRoot`
 * before calling; they own deleting that scope once the run completes (Garbage Collection).
 */
export const docuviaApi = {
  async init(scopeId: string, logger: ILogger): Promise<InitResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new InitWorkflow(workspaceRoot, logger).execute();
  },

  async clean(scopeId: string, logger: ILogger): Promise<CleanResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new CleanWorkflow(workspaceRoot, logger).execute();
  },

  async status(scopeId: string, logger: ILogger): Promise<StatusResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new StatusWorkflow(workspaceRoot, logger).execute();
  },

  async sync(scopeId: string, logger: ILogger): Promise<SyncResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const apiUrl = requireMemory<string>(scopeId, MemoryKeys.API_URL);
    const pat = requireMemory<string>(scopeId, MemoryKeys.PAT);
    const projectId = requireMemory<string>(scopeId, MemoryKeys.PROJECT_ID);
    const commitSha = docuviaMemory.get<string>(scopeId, MemoryKeys.COMMIT_SHA);
    return new SyncWorkflow(workspaceRoot, logger, apiUrl, pat).execute({
      projectId,
      commitSha,
    });
  },

  async analyze(scopeId: string, logger: ILogger): Promise<AnalyzeResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    // `analyze --flush-staged-l3` (issue #42 §8.2): checked first -- sets neither `targetPath`
    // nor `escalateToLsp`, so there's no ambiguity with the branches below.
    const flushStagedL3 = docuviaMemory.get<boolean>(
      scopeId,
      MemoryKeys.FLUSH_STAGED_L3,
    );
    if (flushStagedL3) {
      return new AnalyzeWorkflow(workspaceRoot, logger, {
        flushStagedL3: true,
      }).execute();
    }

    const targetPath = docuviaMemory.get<string>(
      scopeId,
      MemoryKeys.TARGET_PATH,
    );
    // `analyze <targetPath> --agent-authored` (issue #42): checked before the LLM-config branch
    // below, which otherwise unconditionally `requireMemory`s LLM_BASE_URL/LLM_MODEL the moment
    // `targetPath` is truthy -- agent-authored mode never sets those and must skip that
    // requirement entirely.
    const agentAuthoredDecisions = docuviaMemory.get<ExtractedDecision[]>(
      scopeId,
      MemoryKeys.AGENT_AUTHORED_DECISIONS,
    );
    if (targetPath && agentAuthoredDecisions) {
      return new AnalyzeWorkflow(workspaceRoot, logger, {
        targetPath,
        agentAuthoredDecisions,
      }).execute();
    }
    if (targetPath) {
      const llmBaseUrl = requireMemory<string>(
        scopeId,
        MemoryKeys.LLM_BASE_URL,
      );
      const llmModel = requireMemory<string>(scopeId, MemoryKeys.LLM_MODEL);
      const llmApiKey = docuviaMemory.get<string>(
        scopeId,
        MemoryKeys.LLM_API_KEY,
      );
      return new AnalyzeWorkflow(workspaceRoot, logger, {
        targetPath,
        llmBaseUrl,
        llmApiKey,
        llmModel,
      }).execute();
    }

    const escalateToLsp = docuviaMemory.get<boolean>(
      scopeId,
      MemoryKeys.ESCALATE_TO_LSP,
    );
    if (escalateToLsp) {
      return new AnalyzeWorkflow(workspaceRoot, logger, {
        escalateToLsp: true,
        lspProviderConfig: buildLspProviderConfig(scopeId),
        tierBCommitCap: docuviaMemory.get<number>(
          scopeId,
          MemoryKeys.TIER_B_COMMIT_CAP,
        ),
        full: docuviaMemory.get<boolean>(
          scopeId,
          MemoryKeys.TIER_B_FULL_RESYNC,
        ),
        // Tier C's LLM config doubles up on the same memory keys `targetPath` mode uses (§9,
        // folded into the same `--escalate-to-lsp` run) -- optional here (unlike `targetPath`
        // mode's hard-fail-on-missing-env): a missing bridge config degrades honestly (Tier C
        // drain skipped, LSP escalation still runs), per `run-tier-c-drain.ts`'s honest-
        // degradation contract.
        llmBaseUrl: docuviaMemory.get<string>(scopeId, MemoryKeys.LLM_BASE_URL),
        llmApiKey: docuviaMemory.get<string>(scopeId, MemoryKeys.LLM_API_KEY),
        llmModel: docuviaMemory.get<string>(scopeId, MemoryKeys.LLM_MODEL),
        tierCDailyCallCap: docuviaMemory.get<number>(
          scopeId,
          MemoryKeys.TIER_C_DAILY_CALL_CAP,
        ),
        tierCDailyTokenCap: docuviaMemory.get<number>(
          scopeId,
          MemoryKeys.TIER_C_DAILY_TOKEN_CAP,
        ),
        tierCWallClockMs: docuviaMemory.get<number>(
          scopeId,
          MemoryKeys.TIER_C_WALL_CLOCK_MS,
        ),
        tierCItemCap: docuviaMemory.get<number>(
          scopeId,
          MemoryKeys.TIER_C_ITEM_CAP,
        ),
        tierCLoadThreshold: docuviaMemory.get<number>(
          scopeId,
          MemoryKeys.TIER_C_LOAD_THRESHOLD,
        ),
        force: docuviaMemory.get<boolean>(scopeId, "force" as any),
      }).execute();
    }

    return new AnalyzeWorkflow(workspaceRoot, logger).execute();
  },

  /** `analyze <targetPath> --agent-authored --stage` (issue #42 §8.1) -- appends
   *  `AGENT_AUTHORED_DECISIONS` into `.docuvia/pending-l3-decisions.json` instead of writing
   *  straight to `l3_nodes`; fast, local, no DB open, no LLM call. A sibling entry point to
   *  `analyze()`, not a mode of it -- staging never touches `AnalyzeWorkflow.execute()`'s
   *  dispatch chain at all (mirrors `checkTierBGate`'s precedent of a small capability with its
   *  own dedicated `docuviaApi` method rather than being folded into `analyze`'s memory-key
   *  dispatch). */
  async stageAgentAuthoredDecisions(
    scopeId: string,
    logger: ILogger,
  ): Promise<{ staged: number }> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const targetPath = requireMemory<string>(scopeId, MemoryKeys.TARGET_PATH);
    const decisions = requireMemory<ExtractedDecision[]>(
      scopeId,
      MemoryKeys.AGENT_AUTHORED_DECISIONS,
    );
    // Mirrors `run-agent-authored-write`'s own existence check (issue #53 finding 3) -- the
    // non-stage path hard-fails with FS_READ_FAILED on a missing target, so staging one for a
    // typo'd/nonexistent path must fail at input time too, rather than leaving an entry pending
    // until flush (where it would be silently dropped). `existsSync` (not `stat`) matches the
    // direct path's primitive and keeps this a cheap input-time guard.
    const resolvedPath = path.resolve(workspaceRoot, targetPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new DocuviaError(
        ErrorCodes.FS_READ_FAILED,
        ANALYZE_MESSAGES.PATH_NOT_FOUND(targetPath),
      );
    }
    return stagePendingDecisions(workspaceRoot, targetPath, decisions, logger);
  },

  async review(scopeId: string, logger: ILogger): Promise<ReviewResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const baseRef = docuviaMemory.get<string>(scopeId, MemoryKeys.BASE_REF);
    return new ReviewWorkflow(workspaceRoot, logger).execute(baseRef);
  },

  async impact(scopeId: string, logger: ILogger): Promise<ImpactResult | null> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const target = requireMemory<string>(scopeId, MemoryKeys.TARGET);
    return new ImpactWorkflow(workspaceRoot, logger).execute(target);
  },

  async query(scopeId: string, logger: ILogger): Promise<QueryResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const target = requireMemory<string>(scopeId, MemoryKeys.TARGET);
    const limit = docuviaMemory.get<number>(scopeId, MemoryKeys.LIMIT);
    return new QueryWorkflow(workspaceRoot, logger).execute(target, limit);
  },

  async exportTopology(
    scopeId: string,
    logger: ILogger,
  ): Promise<TopologyGraph> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const collapse = docuviaMemory.get<TopologyExportOptions["collapse"]>(
      scopeId,
      MemoryKeys.COLLAPSE,
    );
    return new ExportTopologyWorkflow(workspaceRoot, logger).execute({
      collapse,
    });
  },

  async snapshot(scopeId: string, logger: ILogger): Promise<SnapshotResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new SnapshotWorkflow(workspaceRoot, logger).execute();
  },

  async hydrate(
    scopeId: string,
    logger: ILogger,
    options?: { force?: boolean },
  ): Promise<HydrateResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new HydrateWorkflow(workspaceRoot, logger).execute(options);
  },

  async syncKnowledge(
    scopeId: string,
    logger: ILogger,
  ): Promise<KnowledgeBranchSyncResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const gitNetworkTimeoutMs = docuviaMemory.get<number>(
      scopeId,
      MemoryKeys.GIT_NETWORK_TIMEOUT_MS,
    );
    return new SyncKnowledgeWorkflow(
      workspaceRoot,
      logger,
      gitNetworkTimeoutMs,
    ).execute();
  },

  async doctor(
    scopeId: string,
    logger: ILogger,
    options?: DoctorOptions,
  ): Promise<DoctorResult> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return new DoctorWorkflow(workspaceRoot, logger).execute(options);
  },

  /** `uninstall`'s git-artifact-removal half (phase1-decision-integration.md §10a) — removes both
   *  git hooks `init` installs, plus the hidden `docuvia-knowledge` branch unless `--keep-db`. See
   *  `UninstallHooksWorkflow`'s doc comment. */
  async uninstallGitHooks(
    scopeId: string,
    logger: ILogger,
  ): Promise<{
    postCommitRemoved: boolean;
    prePushRemoved: boolean;
    knowledgeBranchDeleted: boolean;
  }> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const keepDb = docuviaMemory.get<boolean>(scopeId, MemoryKeys.KEEP_DB);
    return new UninstallHooksWorkflow(workspaceRoot, logger).execute(keepDb);
  },

  /** `uninstall`'s wholesale `.docuvia/` directory removal (unless `--keep-db`) — the "leave the
   *  repo pristine" step `docuvia clean` deliberately doesn't do on its own. See
   *  `removeDocuviaDataDir`'s doc comment. */
  async removeDocuviaDir(
    scopeId: string,
    logger: ILogger,
  ): Promise<{ removed: boolean }> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return removeDocuviaDataDir(workspaceRoot, logger);
  },

  /** `docuvia hooks list` (issue #42 §7.3) -- reads `.docuvia/hooks-config.json`, defaults-filled. */
  async listHooks(scopeId: string, logger: ILogger): Promise<HooksConfig> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return listHooksWorkflow(workspaceRoot, logger);
  },

  /** `docuvia hooks enable/disable <hookName>` (issue #42 §7.3) -- writes the toggle, returns the
   *  full re-read config so the CLI can print a confirming summary. */
  async setHookEnabled(scopeId: string, logger: ILogger): Promise<HooksConfig> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    const hookName = requireMemory<HookName>(scopeId, MemoryKeys.HOOK_NAME);
    const enabled = requireMemory<boolean>(scopeId, MemoryKeys.HOOK_ENABLED);
    return setHookEnabledWorkflow(workspaceRoot, hookName, enabled, logger);
  },

  /** D2's mandatory pre-flight gate for a manual/interactive `analyze --escalate-to-lsp`
   *  invocation (phase1-decision-integration.md §8c) -- see `tier-b-gate.ts`. The CLI calls this
   *  before running the batch itself, only when it intends to prompt the user on a not-ready
   *  result (interactive terminal, no `--fallback-ast`). */
  async checkTierBGate(
    scopeId: string,
    logger: ILogger,
  ): Promise<EdgeResolutionAvailability> {
    const workspaceRoot = requireMemory<string>(
      scopeId,
      MemoryKeys.WORKSPACE_ROOT,
    );
    return checkTierBGate(
      workspaceRoot,
      logger,
      buildLspProviderConfig(scopeId),
    );
  },
};
