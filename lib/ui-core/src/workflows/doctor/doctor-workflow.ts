import {
  docuviaFactory,
  TOKENS,
  DOCUVIA_DIR_NAME,
  DOCUVIA_LOGS_DIR_NAME,
  LOCAL_DB_FILE_NAME,
  ANALYZE_LOG_FILE_NAME,
  DocuviaError,
  ErrorCodes,
  UTF8_ENCODING,
  L3DecisionSources,
  type ILogger,
  type IGraphStore,
  type IGitProvider,
  type DiagnosticResult,
  DiagnosticStatus,
  callResolutionDenominator,
} from "@workspace/contracts";
import {
  GitConstants,
  CLAUDE_HOOKS_DIR,
  CURSOR_HOOKS_DIR,
  DOCUVIA_HOOK_JS_FILENAME,
  DOCUVIA_HOOK_CJS_FILENAME,
} from "@workspace/contracts";
import type { DoctorResult } from "./doctor-result.js";
import {
  DOCTOR_AGENT_PLATFORM_NAMES,
  DOCTOR_DIAGNOSTIC_KEYS,
  DOCTOR_MESSAGES,
  LOG_FILE_EXTENSION,
} from "./doctor-messages.js";
import { isTierBCommitCapExceeded } from "../analyze/tier-b-commit-cap.js";
import { resolveQueuedLanguages } from "../analyze/tier-b-gate.js";
import { readTierCQueue } from "../analyze/tier-c-queue.js";
import { readPendingDecisions } from "../analyze/pending-l3-decisions-store.js";
import { ANALYZE_EVENTS } from "../analyze/analyze-messages.js";
import { aggregateStoredCallResolution } from "../analyze/call-resolution-stats.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { probeDocuviaResolvable } from "./git-hook-resolvability.js";
import * as path from "path";
import * as fs from "fs/promises";

export interface DoctorOptions {
  skipDb?: boolean;
  skipGit?: boolean;
  skipLogs?: boolean;
  /** Skips the Claude/Cursor AI-agent hook presence check -- previously a CLI-only
   *  (`doctor.ts`-side) option; folded in here alongside the check itself so `DoctorOptions` isn't
   *  duplicated across layers. */
  skipHooks?: boolean;
  /** Skips the LSP-binary-readiness check (§10e bullet 4 / §7a-1, T8) -- an escape hatch for
   *  callers that care about `doctor`'s other diagnostics (e.g. SQLite concurrency tests) but
   *  whose fixture project has no LSP environment set up on purpose, mirroring `skipGit`'s
   *  existing precedent for sidestepping an orthogonal check. */
  skipLsp?: boolean;
  /** Skips the Tier C LLM endpoint reachability probe (§10e bullet 3, T7) -- a real network call
   *  with its own timeout, so it's an escape hatch for callers that care about `doctor`'s other
   *  diagnostics (e.g. SQLite concurrency tests spawning several `doctor` processes at once) but
   *  aren't testing LLM connectivity, mirroring `skipGit`/`skipLsp`'s existing precedent for
   *  sidestepping an orthogonal, environment-dependent check. */
  skipLlm?: boolean;
  /** Opt-in repair of stale Docuvia git hooks (§10d, T6; issue #133): the legacy-hook
   *  duplicate-block case (`repairDuplicatePostCommitHook`) and every stale-tier case
   *  `installPostCommitHook`/`installPrePushHook` already upgrade in place -- legacy-only and
   *  pre-flush-l3 post-commit hooks, plus pre-push hooks missing the sync-knowledge /
   *  --fallback-ast env-gate / hooks-check steps. The only `doctor` flag that mutates workspace
   *  files, and only for those specific diagnosed conditions. Never mutates anything when
   *  absent/false. */
  fix?: boolean;
  /** §10e bullet 3 (T7) -- the Tier C CLIProxyAPI endpoint's `baseUrl`/`apiKey`, read from
   *  `process.env` by the Presentation layer (`doctor.ts`) and threaded through here. Absence is
   *  a normal, non-error `doctor` state (Tier C inactive by choice) -- unlike `analyze
   *  <targetPath>`'s hard requirement. */
  llmBaseUrl?: string;
  llmApiKey?: string;
  /** Issue #134: the Tier C model id, read from `process.env` by the Presentation layer the same
   *  way `analyze.ts`'s `resolveAnalyzeLlmConfig` does -- required by `checkBridgeReachability`
   *  (the bridge probe needs a model in its minimal completions body). Absent when Tier C is
   *  unconfigured; the `llm_reachability` check reports PASS ("not configured") either way. */
  llmModel?: string;
}

export class DoctorWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  async execute(options: DoctorOptions = {}): Promise<DoctorResult> {
    const {
      skipDb = false,
      skipGit = false,
      skipLogs = false,
      skipHooks = false,
      skipLsp = false,
      skipLlm = false,
      fix = false,
      llmBaseUrl,
      llmApiKey,
      llmModel,
    } = options;
    const diagnostics: Record<string, DiagnosticResult> = {};

    const results: boolean[] = [
      await this.runOrSkip(skipDb, () => this.runDbDiagnostics(diagnostics)),
      await this.runOrSkip(skipGit, () => this.runGitDiagnostics(diagnostics)),
      await this.runOrSkip(skipLogs, () =>
        this.runLogsDiagnostics(diagnostics),
      ),
      await this.runOrSkip(skipGit, () =>
        this.runGitHookDiagnostic(diagnostics, fix),
      ),
      await this.runOrSkip(skipGit, () =>
        this.runPrePushHookDiagnostic(diagnostics, fix),
      ),
      await this.runOrSkip(skipLlm, () =>
        this.runLlmReachabilityDiagnostic(
          diagnostics,
          llmBaseUrl,
          llmApiKey,
          llmModel,
        ),
      ),
      await this.runOrSkip(skipLsp, () =>
        this.runLspBinaryDiagnostic(diagnostics),
      ),
      await this.runOrSkip(skipDb, () =>
        this.runTierBCoverageDiagnostic(diagnostics),
      ),
      // Issue #57: the never-ingested state (`db_found` passes on the file's existence alone).
      await this.runOrSkip(skipDb, () =>
        this.runGraphEmptyDiagnostic(diagnostics),
      ),
      // Issue #58: the post-commit hook's backgrounded delta ingestion may never fire (its
      // fire-and-forget process can die with the hook's shell, silently leaving the graph
      // behind HEAD) -- needs both the db (lastIngestedSourceSha) and git (HEAD), so gated on
      // either being skipped.
      await this.runOrSkip(skipDb || skipGit, () =>
        this.runPostCommitIngestionDiagnostic(diagnostics),
      ),
      // Issues #134/#135/#137/#139: the graph-health cohort -- pulled into a separate method so
      // their `skipX || skipY` gates don't push `execute()`'s own cyclomatic complexity over the
      // ESLint budget (same reason `runOrSkip` exists).
      ...(await this.runGraphHealthDiagnostics(
        diagnostics,
        skipDb,
        skipGit,
        llmBaseUrl,
      )),
    ];

    // §10c's doctor-half backup (T4) only needs the db as of §9m item 1 (the commit-cap's metric
    // moved to a store-persisted counter, no git call) -- gated behind skipDb alone now, not a new
    // dedicated flag. Always PASS (decision 1d) -- never affects allPassed.
    await this.runOrSkip(skipDb, () =>
      this.runTierBCommitCapDiagnostic(diagnostics),
    );
    // Folded in from doctor.ts's plain fs.stat logic (workflows/doctor-execution-flow.md's
    // Presentation-layer asymmetry cleanup) -- always PASS, same as above; a platform never
    // selected at init is a legitimate state, not a defect, so this must never affect allPassed.
    await this.runOrSkip(skipHooks, () =>
      this.runAgentHooksDiagnostic(diagnostics),
    );

    return {
      allPassed: results.every(Boolean),
      diagnostics,
    };
  }

  /** `skip ? true (no-op) : run()` -- pulled out of `execute()` so each of its five checks is a
   *  single, ternary-free statement there, keeping `execute()` itself well under the ESLint
   *  complexity budget as the checks this slice adds accumulate. */
  private async runOrSkip(
    skip: boolean,
    run: () => Promise<unknown>,
  ): Promise<boolean> {
    if (skip) return true;
    const result = await run();
    return result === undefined ? true : Boolean(result);
  }

  /** The issues #134/#135/#137/#139 graph-health cohort, registered as one spread so `execute()`
   *  stays under the complexity budget (the `skipDb || skipGit` gate here would otherwise count
   *  against `execute()`'s own cyclomatic complexity). */
  private async runGraphHealthDiagnostics(
    diagnostics: Record<string, DiagnosticResult>,
    skipDb: boolean,
    skipGit: boolean,
    llmBaseUrl: string | undefined,
  ): Promise<boolean[]> {
    return [
      // Issue #134: the permanently-stuck Tier C queue (non-empty + a last drain that processed
      // nothing) -- db-only, gated on skipDb.
      await this.runOrSkip(skipDb, () =>
        this.runTierCQueueDiagnostic(diagnostics),
      ),
      // Issue #135: L2 semantic coverage -- db-only, gated on skipDb. FAILs only when Tier C is
      // configured (`llmBaseUrl`): an AST-only graph with no LLM enrichment is structural-only by
      // design, and doctor must not permanently red a setup that can't write descriptions.
      await this.runOrSkip(skipDb, () =>
        this.runL2SemanticCoverageDiagnostic(diagnostics, llmBaseUrl),
      ),
      // Issue #137: per-worktree knowledge-graph fragmentation -- git-only, gated on skipGit.
      await this.runOrSkip(skipGit, () =>
        this.runWorktreeDivergenceDiagnostic(diagnostics),
      ),
      // Issue #139: docuvia-first workflow adoption -- needs both the db (agent-authored L3
      // counts) and git (recently-changed files), gated on either being skipped.
      await this.runOrSkip(skipDb || skipGit, () =>
        this.runAgentAuthoredAdoptionDiagnostic(diagnostics),
      ),
      // Issue #221: Tier A call-graph resolution health -- db-only (the counters live under
      // META_KEY_CALL_RESOLUTION_STATS), gated on skipDb. Informational-only (always true).
      await this.runOrSkip(skipDb, () =>
        this.runCallGraphResolutionDiagnostic(diagnostics),
      ),
      // Issue #221 P3: the canary self-test -- db-only, gated on skipDb. Unlike the two
      // informational checks above, a lookup/FTS desync is a real integrity defect -> FAILs.
      await this.runOrSkip(skipDb, () =>
        this.runCanarySelfTestDiagnostic(diagnostics),
      ),
    ];
  }

  /**
   * Issue #221 P3: the graph-integrity canary. Samples a few known-present `l2_nodes` names and
   * asserts the two read paths every query/impact depends on actually see them:
   * 1. exact-name lookup (`findNodeByName`) resolves each sampled name;
   * 2. FTS search for a token derived from a sampled name returns rows (the `l2_nodes_fts` sync
   *    triggers are suspended during bulk loads -- a desynced index silently zeroes out keyword
   *    queries while counts look healthy, roadmap item 25's failure class).
   * An empty sample degrades to silently skipped (covered by `graph_empty`'s own FAIL). Never
   * throws past this method.
   */
  private async runCanarySelfTestDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.GraphStoreOpener)) return true;

    let store: IGraphStore | undefined;
    try {
      const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
      store = await openStore({
        dbPath: resolveDbPath(this.workspaceRoot),
        readonly: true,
      });

      const sample = store.graph.getCanarySample(
        GitConstants.DEFAULT_CANARY_SAMPLE_SIZE,
      );
      if (sample.length === 0) return true;

      // Check 1: every sampled name must resolve through query/impact's own entry point.
      const missed = sample.filter(
        ({ name }) => !store?.graph.findNodeByName(name),
      );
      if (missed.length > 0) {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.CANARY_SELF_TEST] = {
          status: DiagnosticStatus.FAIL,
          message: DOCTOR_MESSAGES.CANARY_SELF_TEST_LOOKUP_FAIL(
            missed.length,
            sample.length,
          ),
          suggestion: DOCTOR_MESSAGES.CANARY_SELF_TEST_FAIL_SUGGESTION,
        };
        return false;
      }

      // Check 2: FTS must answer for a token derived from a real node's name. Tokens shorter
      // than three alphanumeric chars are noise-prone (single letters, version suffixes), so a
      // name without one skips the check rather than failing on an unsuitable probe.
      let ftsToken: string | undefined;
      for (const { name } of sample) {
        const segments = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
        ftsToken = segments.reduce(
          (best, s) => (s.length >= 3 && s.length > best.length ? s : best),
          "",
        );
        if (ftsToken) break;
      }
      if (ftsToken) {
        const hits = store.fts.searchL2Nodes([ftsToken], 10);
        if (hits.length === 0) {
          diagnostics[DOCTOR_DIAGNOSTIC_KEYS.CANARY_SELF_TEST] = {
            status: DiagnosticStatus.FAIL,
            message: DOCTOR_MESSAGES.CANARY_SELF_TEST_FTS_FAIL(ftsToken),
            suggestion: DOCTOR_MESSAGES.CANARY_SELF_TEST_FAIL_SUGGESTION,
          };
          return false;
        }
      }

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.CANARY_SELF_TEST] = {
        status: DiagnosticStatus.PASS,
        message: DOCTOR_MESSAGES.CANARY_SELF_TEST_OK(sample.length),
      };
      return true;
    } catch {
      // db not found/unopenable (already covered by db_found's own FAIL) -- degrades to
      // silently skipped, never a doctor crash.
      return true;
    } finally {
      await store?.close();
    }
  }

  /**
   * §10d/§7c (T5): detects the legacy-hook duplicate-block case and the "hook present but
   * docuvia not resolvable" case; §10d (T6): when `fix` is true and the duplicate-block case is
   * detected, performs the explicit, opt-in repair. Resolves `TOKENS.GitProvider` for the
   * read-only inspection (no need for `TOKENS.KnowledgeGitService` for that half -- this is
   * read-only, not a Docuvia-domain mutation). Never throws past this method -- a read failure
   * degrades to a skipped check.
   */
  private async runGitHookDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
    fix: boolean,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.GitProvider)) return true;

    try {
      const git = docuviaFactory.resolve(TOKENS.GitProvider);
      const hook = await git.readHookFile(
        this.workspaceRoot,
        GitConstants.POST_COMMIT_HOOK_NAME,
      );
      const hasCurrent = !!hook?.includes(GitConstants.POST_COMMIT_HOOK_MARKER);
      const hasLegacy = !!hook?.includes(
        GitConstants.LEGACY_POST_COMMIT_HOOK_MARKER,
      );
      // Issue #48: a hook that already runs `docuvia analyze` but predates the `--flush-staged-l3`
      // step (#42's commit-l3-write) would silently never flush staged agent-authored L3 decisions.
      const hasFlushMarker = !!hook?.includes(
        GitConstants.POST_COMMIT_FLUSH_L3_MARKER,
      );

      let result = await this.classifyGitHookState(
        git,
        hasCurrent,
        hasLegacy,
        hasFlushMarker,
      );
      result = await this.repairGitHookIfRequested(
        fix,
        result,
        hasCurrent,
        hasLegacy,
        hasFlushMarker,
      );

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.GIT_HOOK] = result;
      return result.status === DiagnosticStatus.PASS;
    } catch {
      return true;
    }
  }

  /** Issue #133: dispatches `doctor --fix`'s post-commit repairs. The duplicate-block case keeps
   *  its dedicated marker-bounded extraction (`repairDuplicatePostCommitHook`); every other
   *  diagnosed FAIL that `installPostCommitHook` can upgrade in place (legacy-only, or
   *  current-shaped but predating the commit-l3-write flush step) is delegated to it. A
   *  healthy/absent hook, or a resolvability-only FAIL (all markers present, npx missing), is
   *  never touched. Split out so `runGitHookDiagnostic`'s own complexity budget stays flat. */
  private async repairGitHookIfRequested(
    fix: boolean,
    result: DiagnosticResult,
    hasCurrent: boolean,
    hasLegacy: boolean,
    hasFlushMarker: boolean,
  ): Promise<DiagnosticResult> {
    if (!fix) return result;
    if (hasCurrent && hasLegacy) {
      return this.repairDuplicateGitHookIfRequested(result);
    }
    if (result.status === DiagnosticStatus.FAIL && !hasFlushMarker) {
      return this.repairStaleGitHookIfRequested(result);
    }
    return result;
  }

  /** Issue #133: upgrades a stale-tier post-commit hook via `installPostCommitHook` (which
   *  exact-content-matches the old tier and replaces it in place) and notes the repair, mirroring
   *  `repairDuplicateGitHookIfRequested`'s never-silently-mutate / never-silently-claim-fixed
   *  shape (§10d). */
  private async repairStaleGitHookIfRequested(
    result: DiagnosticResult,
  ): Promise<DiagnosticResult> {
    if (!docuviaFactory.has(TOKENS.KnowledgeGitService)) return result;

    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger: this.logger,
    });
    const { installed } = await knowledgeGit.installPostCommitHook(
      this.workspaceRoot,
    );
    if (!installed) return result;

    return {
      ...result,
      message: result.message + DOCTOR_MESSAGES.GIT_HOOK_REPAIRED_NOTE,
    };
  }

  /** The marker-based branches of `runGitHookDiagnostic`, plus (only for the healthy-shaped
   *  case) the live resolvability probe -- split out to keep `runGitHookDiagnostic` itself under
   *  the ESLint complexity budget. */
  private async classifyGitHookState(
    git: IGitProvider,
    hasCurrent: boolean,
    hasLegacy: boolean,
    hasFlushMarker: boolean,
  ): Promise<DiagnosticResult> {
    if (!hasCurrent && !hasLegacy) {
      return {
        status: DiagnosticStatus.PASS,
        message: DOCTOR_MESSAGES.GIT_HOOK_NOT_INSTALLED,
      };
    }
    if (hasCurrent && hasLegacy) {
      return {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.GIT_HOOK_DUPLICATE,
        suggestion: DOCTOR_MESSAGES.GIT_HOOK_DUPLICATE_SUGGESTION,
      };
    }
    if (hasLegacy) {
      return {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.GIT_HOOK_LEGACY_ONLY,
        suggestion: DOCTOR_MESSAGES.GIT_HOOK_LEGACY_ONLY_SUGGESTION,
      };
    }
    // Issue #48: a current-shaped hook that still predates the commit-l3-write flush step is
    // stale in a way `POST_COMMIT_HOOK_MARKER` alone can't see -- `doctor` must not report it OK.
    if (!hasFlushMarker) {
      return {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.GIT_HOOK_FLUSH_STALE,
        suggestion: DOCTOR_MESSAGES.GIT_HOOK_FLUSH_STALE_SUGGESTION,
      };
    }

    const resolvable = await probeDocuviaResolvable(this.workspaceRoot);
    if (!resolvable) {
      return {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.GIT_HOOK_NOT_RESOLVABLE,
        suggestion: DOCTOR_MESSAGES.GIT_HOOK_NOT_RESOLVABLE_SUGGESTION,
      };
    }

    const hooksDir = await git.resolveHooksDir(this.workspaceRoot);
    return {
      status: DiagnosticStatus.PASS,
      message: DOCTOR_MESSAGES.GIT_HOOK_RESOLVABLE(
        path.join(hooksDir, GitConstants.POST_COMMIT_HOOK_NAME),
      ),
    };
  }

  /**
   * `doctor --fix`'s repair call (T6) -- only reached when `fix` is true and the duplicate-block
   * condition was just detected. Reports the outcome by appending a note to the existing FAIL
   * result rather than silently claiming PASS for a condition that was true moments before
   * checking (§10d: never silently mutate, and never silently claim fixed).
   */
  private async repairDuplicateGitHookIfRequested(
    result: DiagnosticResult,
  ): Promise<DiagnosticResult> {
    if (!docuviaFactory.has(TOKENS.KnowledgeGitService)) return result;

    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger: this.logger,
    });
    const { repaired } = await knowledgeGit.repairDuplicatePostCommitHook(
      this.workspaceRoot,
    );
    if (!repaired) return result;

    return {
      ...result,
      message: result.message + DOCTOR_MESSAGES.GIT_HOOK_REPAIRED_NOTE,
    };
  }

  /**
   * phase2-sync-knowledge-scheduling.md SKSCHED-005: flags a pre-push hook installed before the
   * `sync-knowledge` step was composed into it (SKSCHED-001/003) -- distinct hook file, distinct
   * diagnostic key from `runGitHookDiagnostic`'s post-commit checks. No duplicate-block case here
   * (unlike post-commit's legacy upgrade): `installPrePushHook` upgrades a stale hook via an
   * exact-content-match replace, not append, so `doctor --fix` dispatches to it directly (issue
   * #133). A healthy-shaped hook still gets the same
   * `probeDocuviaResolvable` live check `runGitHookDiagnostic`'s post-commit case already runs --
   * found missing here via dogfooding this exact hook on Docuvia2 itself (2026-07-21): a pre-push
   * hook can be perfectly up to date and still silently no-op every push if `docuvia` itself isn't
   * `npx --no-install`-resolvable, and content-only marker checks can't see that. Never throws
   * past this method.
   */
  private async runPrePushHookDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
    fix: boolean,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.GitProvider)) return true;

    try {
      const git = docuviaFactory.resolve(TOKENS.GitProvider);
      const hook = await git.readHookFile(
        this.workspaceRoot,
        GitConstants.PRE_PUSH_HOOK_NAME,
      );
      const hasCurrent = !!hook?.includes(GitConstants.PRE_PUSH_HOOK_MARKER);
      const hasSyncKnowledge = !!hook?.includes(
        GitConstants.PRE_PUSH_SYNC_KNOWLEDGE_MARKER,
      );
      const hasEnvGate = !!hook?.includes(
        GitConstants.PRE_PUSH_ENV_GATE_MARKER,
      );
      // Issue #48: a hook that already has the sync-knowledge + env-gate steps but predates the
      // `hooks check` gate (#42's tier-b-c-prepush toggle) would run the whole Tier B/snapshot/
      // sync-knowledge chain even when the user disabled it via `docuvia hooks disable`.
      const hasHooksCheck = !!hook?.includes(
        GitConstants.PRE_PUSH_HOOKS_CHECK_MARKER,
      );

      let result = await this.classifyPrePushHookState(
        git,
        hasCurrent,
        hasSyncKnowledge,
        hasEnvGate,
        hasHooksCheck,
      );
      result = await this.repairPrePushHookIfRequested(
        fix,
        result,
        hasCurrent,
        hasSyncKnowledge,
        hasEnvGate,
        hasHooksCheck,
      );

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.PRE_PUSH_HOOK] = result;
      return result.status === DiagnosticStatus.PASS;
    } catch {
      return true;
    }
  }

  /** Issue #133: dispatches `doctor --fix`'s pre-push repair. A pre-push hook carrying the
   *  current marker but missing any of the sync-knowledge / --fallback-ast env-gate / hooks-check
   *  steps is stale and is upgraded in place via `installPrePushHook`. A healthy hook, an absent
   *  hook, or a resolvability-only FAIL (all markers present) is never touched. */
  private async repairPrePushHookIfRequested(
    fix: boolean,
    result: DiagnosticResult,
    hasCurrent: boolean,
    hasSyncKnowledge: boolean,
    hasEnvGate: boolean,
    hasHooksCheck: boolean,
  ): Promise<DiagnosticResult> {
    if (!fix || !hasCurrent) return result;
    if (hasSyncKnowledge && hasEnvGate && hasHooksCheck) return result;
    return this.repairStalePrePushHookIfRequested(result);
  }

  /** Issue #133: upgrades a stale pre-push hook via `installPrePushHook` (exact-content-match
   *  replace) and notes the repair -- same never-silently-mutate / never-silently-claim-fixed
   *  shape as the post-commit repairs (§10d). */
  private async repairStalePrePushHookIfRequested(
    result: DiagnosticResult,
  ): Promise<DiagnosticResult> {
    if (!docuviaFactory.has(TOKENS.KnowledgeGitService)) return result;

    const knowledgeGit = docuviaFactory.resolve(TOKENS.KnowledgeGitService, {
      logger: this.logger,
    });
    const { installed } = await knowledgeGit.installPrePushHook(
      this.workspaceRoot,
    );
    if (!installed) return result;

    return {
      ...result,
      message: result.message + DOCTOR_MESSAGES.PRE_PUSH_HOOK_REPAIRED_NOTE,
    };
  }

  /** The marker-based branches of `runPrePushHookDiagnostic`, plus (only for the healthy-shaped
   *  case) the live resolvability probe -- split out to keep `runPrePushHookDiagnostic` itself
   *  under the ESLint complexity budget, mirroring `classifyGitHookState` for post-commit. */
  private async classifyPrePushHookState(
    git: IGitProvider,
    hasCurrent: boolean,
    hasSyncKnowledge: boolean,
    hasEnvGate: boolean,
    hasHooksCheck: boolean,
  ): Promise<DiagnosticResult> {
    if (!hasCurrent) {
      return {
        status: DiagnosticStatus.PASS,
        message: DOCTOR_MESSAGES.PRE_PUSH_HOOK_NOT_INSTALLED,
      };
    }
    if (!hasSyncKnowledge) {
      return {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.PRE_PUSH_HOOK_STALE,
        suggestion: DOCTOR_MESSAGES.PRE_PUSH_HOOK_STALE_SUGGESTION,
      };
    }
    if (!hasEnvGate) {
      return {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.PRE_PUSH_HOOK_ENV_GATE_STALE,
        suggestion: DOCTOR_MESSAGES.PRE_PUSH_HOOK_STALE_SUGGESTION,
      };
    }
    // Issue #48: a hook that already has the sync-knowledge + env-gate steps but predates the
    // `hooks check` gate would run the chain even when `tier-b-c-prepush` is disabled.
    if (!hasHooksCheck) {
      return {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.PRE_PUSH_HOOK_HOOKS_CHECK_STALE,
        suggestion: DOCTOR_MESSAGES.PRE_PUSH_HOOK_STALE_SUGGESTION,
      };
    }

    const resolvable = await probeDocuviaResolvable(this.workspaceRoot);
    if (!resolvable) {
      return {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.PRE_PUSH_HOOK_NOT_RESOLVABLE,
        suggestion: DOCTOR_MESSAGES.GIT_HOOK_NOT_RESOLVABLE_SUGGESTION,
      };
    }

    const hooksDir = await git.resolveHooksDir(this.workspaceRoot);
    return {
      status: DiagnosticStatus.PASS,
      message: DOCTOR_MESSAGES.PRE_PUSH_HOOK_OK(
        path.join(hooksDir, GitConstants.PRE_PUSH_HOOK_NAME),
      ),
    };
  }

  /**
   * §10e bullet 3 (T7): a real reachability pre-flight probe for the Tier C CLIProxyAPI endpoint,
   * via `ILlmClient.checkBridgeReachability()` (issue #134). No base URL (or no model) supplied is
   * a normal, non-error `doctor` state (decision 1c) -- `PASS`, "not configured." Configured-but-
   * unreachable is the one real defect this check reports -- `FAIL`. Never throws past this method.
   */
  private async runLlmReachabilityDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
    llmBaseUrl: string | undefined,
    llmApiKey: string | undefined,
    llmModel: string | undefined,
  ): Promise<boolean> {
    if (!llmBaseUrl || !llmModel) {
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LLM_REACHABILITY] = {
        status: DiagnosticStatus.PASS,
        message: DOCTOR_MESSAGES.LLM_NOT_CONFIGURED,
      };
      return true;
    }
    if (!docuviaFactory.has(TOKENS.LlmClient)) return true;

    try {
      const buildLlmClient = docuviaFactory.resolve(TOKENS.LlmClient);
      const llmClient = buildLlmClient();
      llmClient.initialize({ baseUrl: llmBaseUrl, apiKey: llmApiKey });
      const availability = await llmClient.checkBridgeReachability(llmModel);

      if (availability.available) {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LLM_REACHABILITY] = {
          status: DiagnosticStatus.PASS,
          message: DOCTOR_MESSAGES.LLM_REACHABLE,
        };
        return true;
      }

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LLM_REACHABILITY] = {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.LLM_UNREACHABLE(availability.reason ?? ""),
        suggestion: DOCTOR_MESSAGES.LLM_UNREACHABLE_SUGGESTION,
      };
      return false;
    } catch {
      return true;
    }
  }

  /**
   * §10e bullet 4 / §7a-1 (T8): LSP binary presence, independent of whether a Tier B batch has
   * ever run -- pure wiring, reusing Slice 3's shipped `IEdgeResolutionProvider.checkAvailability()`
   * verbatim (the exact same token `checkTierBGate` resolves, `tier-b-gate.ts:23`). Reports FAIL
   * when a queued language's provider is unavailable -- environment readiness for Tier B is a real
   * defect, not merely informative (2026-07 C#/TS benchmark finding: a target project that was
   * never built silently produced wasted, inaccurate `analyze --escalate-to-lsp` runs because
   * nothing surfaced this as a failure beforehand). Never throws past this method.
   *
   * multi-language-lsp-support plan, Finding G: reuses `resolveQueuedLanguages` (the same scoping
   * `checkTierBGate` applies) rather than iterating the full `TOKENS.EdgeResolutionProviders`
   * registry, so a project that only uses one language never fails doctor over an unrelated
   * language's LSP binary being absent.
   */
  private async runLspBinaryDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.EdgeResolutionProviders)) return true;

    try {
      const registry = docuviaFactory.resolve(TOKENS.EdgeResolutionProviders, {
        logger: this.logger,
      });
      const languagesToCheck = await resolveQueuedLanguages(
        this.workspaceRoot,
        registry,
      );

      let allAvailable = true;
      for (const languageId of languagesToCheck) {
        const buildProvider = registry[languageId];
        if (!buildProvider) continue;
        const provider = buildProvider();
        const availability = await provider.checkAvailability(
          this.workspaceRoot,
        );

        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LSP_BINARY(languageId)] =
          availability.available
            ? {
                status: DiagnosticStatus.PASS,
                message: DOCTOR_MESSAGES.LSP_BINARY_AVAILABLE(provider.name),
              }
            : {
                status: DiagnosticStatus.FAIL,
                message: DOCTOR_MESSAGES.LSP_BINARY_UNAVAILABLE(
                  availability.reason ?? "",
                ),
                suggestion: DOCTOR_MESSAGES.LSP_BINARY_UNAVAILABLE_SUGGESTION,
              };
        if (!availability.available) allAvailable = false;
      }
      return allAvailable;
    } catch {
      // Never crash doctor over this check.
      return true;
    }
  }

  /**
   * Claude/Cursor AI-agent hook presence -- folded in from `doctor.ts`'s plain `fs.stat` logic to
   * close the asymmetry `doctor-execution-flow.md` flagged (every other diagnostic already goes
   * through `DoctorWorkflow`). Always PASS regardless of presence/absence: a platform never
   * selected at `init` is a legitimate state, not a defect -- matches `LLM_NOT_CONFIGURED`'s
   * "not configured is PASS" precedent. `DiagnosticStatus` has no severity between PASS and FAIL,
   * so this deliberately never reports FAIL; never affects `allPassed`. Never throws.
   */
  private async runAgentHooksDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<void> {
    const checks: {
      key: string;
      dir: string;
      filename: string;
      platformName: string;
    }[] = [
      {
        key: DOCTOR_DIAGNOSTIC_KEYS.AGENT_HOOKS_CLAUDE,
        dir: CLAUDE_HOOKS_DIR,
        filename: DOCUVIA_HOOK_JS_FILENAME,
        platformName: DOCTOR_AGENT_PLATFORM_NAMES.CLAUDE,
      },
      {
        key: DOCTOR_DIAGNOSTIC_KEYS.AGENT_HOOKS_CURSOR,
        dir: CURSOR_HOOKS_DIR,
        filename: DOCUVIA_HOOK_CJS_FILENAME,
        platformName: DOCTOR_AGENT_PLATFORM_NAMES.CURSOR,
      },
    ];

    for (const { key, dir, filename, platformName } of checks) {
      const hookPath = path.join(this.workspaceRoot, dir, filename);
      let found: boolean;
      try {
        await fs.stat(hookPath);
        found = true;
      } catch {
        found = false;
      }

      diagnostics[key] = {
        status: DiagnosticStatus.PASS,
        message: found
          ? DOCTOR_MESSAGES.AGENT_HOOKS_FOUND(platformName)
          : DOCTOR_MESSAGES.AGENT_HOOKS_NOT_FOUND(platformName),
      };
    }
  }

  /**
   * §10c's doctor-half backup for the Tier B commit-cap nudge (T3 is Tier A's commit-time half):
   * opens the local db read-only (mirrors `ImpactWorkflow`'s exact pattern) and, if it opens,
   * reports the same `isTierBCommitCapExceeded` condition Tier A's nudge computes -- always
   * `PASS` (decision 1c/1d), since neither "not yet exceeded" nor "exceeded" is itself a defect.
   * A missing/unopenable db (never ran `init`) is *not* a failure of this specific check -- it's
   * already covered by `db_found`'s own FAIL, so this silently skips rather than double-reporting
   * the same root cause under two diagnostic keys. Never throws past this method. No git provider
   * needed as of §9m item 1 -- the commit-cap's metric is now a store-persisted counter.
   */
  private async runTierBCommitCapDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<void> {
    if (!docuviaFactory.has(TOKENS.GraphStoreOpener)) {
      return;
    }

    let store: IGraphStore | undefined;
    try {
      const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
      store = await openStore({
        dbPath: resolveDbPath(this.workspaceRoot),
        readonly: true,
      });

      const exceeded = isTierBCommitCapExceeded(store);

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.TIER_B_COMMIT_CAP] = {
        status: DiagnosticStatus.PASS,
        message: exceeded
          ? DOCTOR_MESSAGES.TIER_B_CAP_EXCEEDED
          : DOCTOR_MESSAGES.TIER_B_CAP_OK,
      };
    } catch {
      // db not found/unopenable (already covered by db_found's own FAIL) or a git-command
      // failure -- either way this check degrades to silently skipped, never a doctor crash.
    } finally {
      await store?.close();
    }
  }

  /**
   * dogfooding-findings-fixes.md Phase 2 (roadmap item 23): workspace-wide Tier B coverage
   * (`store.files.getTierBCoverage()`) as a first-class diagnostic -- previously only surfaced as
   * an incidental note buried inside individual `query`/`impact` responses. Unlike
   * `runTierBCommitCapDiagnostic` above (a different question -- per-commit budget, always PASS),
   * low coverage is a real, actionable gap here: an agent trusting an unprocessed file's empty
   * edges as "no relationships" (rather than "unprocessed") is a correctness risk -- FAIL below
   * `DEFAULT_TIER_B_COVERAGE_FAIL_THRESHOLD`, PASS otherwise. Opens the local db read-only, same
   * pattern as `runTierBCommitCapDiagnostic`; a missing/unopenable db degrades to silently skipped
   * (already covered by `db_found`'s own FAIL), never a doctor crash.
   */
  private async runTierBCoverageDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.GraphStoreOpener)) {
      return true;
    }

    let store: IGraphStore | undefined;
    try {
      const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
      store = await openStore({
        dbPath: resolveDbPath(this.workspaceRoot),
        readonly: true,
      });

      const { totalFiles, processedFiles } = store.files.getTierBCoverage();
      const coverage = totalFiles > 0 ? processedFiles / totalFiles : 1;
      const belowThreshold =
        coverage < GitConstants.DEFAULT_TIER_B_COVERAGE_FAIL_THRESHOLD;

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.TIER_B_COVERAGE] = belowThreshold
        ? {
            status: DiagnosticStatus.FAIL,
            message: DOCTOR_MESSAGES.TIER_B_COVERAGE_LOW(
              processedFiles,
              totalFiles,
              coverage * 100,
            ),
            suggestion: DOCTOR_MESSAGES.TIER_B_COVERAGE_LOW_SUGGESTION,
          }
        : {
            status: DiagnosticStatus.PASS,
            message: DOCTOR_MESSAGES.TIER_B_COVERAGE_OK(
              processedFiles,
              totalFiles,
            ),
          };
      return !belowThreshold;
    } catch {
      // db not found/unopenable (already covered by db_found's own FAIL) -- degrades to silently
      // skipped, never a doctor crash.
      return true;
    } finally {
      await store?.close();
    }
  }

  /**
   * Issue #57: detects the never-ingested graph that `db_found` structurally can't -- the
   * `local.db` *file* exists but the graph inside it is empty (no project row, or 0 L2 nodes).
   * That is exactly the precondition under which `--agent-authored --stage` / `--flush-staged-l3`
   * silently retry forever with nothing to attach decisions to (the only visible trace being a
   * JSONL log line), so this FAILs with a "run `docuvia init`" suggestion. A missing/unopenable
   * db degrades to silently skipped -- already covered by `db_found`'s own FAIL, mirroring
   * `runTierBCoverageDiagnostic`'s pattern. Never throws past this method.
   */
  private async runGraphEmptyDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.GraphStoreOpener)) return true;

    let store: IGraphStore | undefined;
    try {
      const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
      store = await openStore({
        dbPath: resolveDbPath(this.workspaceRoot),
        readonly: true,
      });

      const project = store.projects.getFirst();
      const { l2Nodes } = store.graph.count();
      const isEmpty = !project || l2Nodes === 0;

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.GRAPH_EMPTY] = isEmpty
        ? {
            status: DiagnosticStatus.FAIL,
            message: DOCTOR_MESSAGES.GRAPH_EMPTY,
            suggestion: DOCTOR_MESSAGES.GRAPH_EMPTY_SUGGESTION,
          }
        : {
            status: DiagnosticStatus.PASS,
            message: DOCTOR_MESSAGES.GRAPH_EMPTY_OK(l2Nodes),
          };
      return !isEmpty;
    } catch {
      // db not found/unopenable (already covered by db_found's own FAIL) -- silently skipped,
      // never a doctor crash.
      return true;
    } finally {
      await store?.close();
    }
  }

  /**
   * Issue #58: detects the dead post-commit-hook pipeline that `git_hook` structurally can't --
   * a hook file can be perfectly installed and still never run (its backgrounded `&` process
   * dies with the hook's shell, or `npx --no-install` fails before any JSONL is written), leaving
   * `lastIngestedSourceSha` behind HEAD forever. PASS when the graph is fully up to date; PASS
   * with a note when behind HEAD but an analyze run completed within
   * `DEFAULT_POST_COMMIT_INGESTION_GRACE_MS` (likely still in flight); FAIL when behind HEAD with
   * no recent activity -- issue #58's exact live repro. Also surfaces the Tier C queue size in
   * every message so a permanently-empty queue is visible. A missing/unopenable db, an unborn
   * HEAD, or a missing git provider degrades to silently skipped (already covered by
   * `db_found`/`git_reachability`'s own FAIL), never a doctor crash.
   */
  private async runPostCommitIngestionDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.GraphStoreOpener)) return true;
    if (!docuviaFactory.has(TOKENS.GitProvider)) return true;

    let store: IGraphStore | undefined;
    try {
      const git = docuviaFactory.resolve(TOKENS.GitProvider);
      const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
      store = await openStore({
        dbPath: resolveDbPath(this.workspaceRoot),
        readonly: true,
      });

      const headSha = await git.getHeadSha(this.workspaceRoot);
      if (!headSha) return true; // unborn/headless HEAD -- nothing to compare against

      const lastIngestedSha = store.meta.get(
        GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      );
      const tierCQueued = readTierCQueue(store).length;

      if (lastIngestedSha === headSha) {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.POST_COMMIT_INGESTION] = {
          status: DiagnosticStatus.PASS,
          message: DOCTOR_MESSAGES.POST_COMMIT_INGESTION_OK(tierCQueued),
        };
        return true;
      }

      const recent = await this.hasRecentAnalyzeActivity();
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.POST_COMMIT_INGESTION] = recent
        ? {
            status: DiagnosticStatus.PASS,
            message: DOCTOR_MESSAGES.POST_COMMIT_INGESTION_RECENT(
              lastIngestedSha,
              tierCQueued,
            ),
          }
        : {
            status: DiagnosticStatus.FAIL,
            message: DOCTOR_MESSAGES.POST_COMMIT_INGESTION_STALE(tierCQueued),
            suggestion: DOCTOR_MESSAGES.POST_COMMIT_INGESTION_STALE_SUGGESTION,
          };
      return recent;
    } catch {
      // db not found/unopenable (already covered by db_found's own FAIL) or a git-command
      // failure -- degrades to silently skipped, never a doctor crash.
      return true;
    } finally {
      await store?.close();
    }
  }

  /** `true` when `.docuvia/logs/analyze.log`'s most recent JSONL entry's `ts` is within
   *  `DEFAULT_POST_COMMIT_INGESTION_GRACE_MS` of now -- the "ingestion is (or just was) running"
   *  signal distinguishing an in-flight post-commit run from a permanently-dead one. A missing
   *  or unreadable log (no evidence the hook ever ran) is `false`. Malformed lines are ignored. */
  private async hasRecentAnalyzeActivity(): Promise<boolean> {
    const logPath = path.join(
      this.workspaceRoot,
      DOCUVIA_DIR_NAME,
      DOCUVIA_LOGS_DIR_NAME,
      ANALYZE_LOG_FILE_NAME,
    );

    let content: string;
    try {
      content = await fs.readFile(logPath, UTF8_ENCODING);
    } catch {
      return false;
    }

    const graceMs = GitConstants.DEFAULT_POST_COMMIT_INGESTION_GRACE_MS;
    const now = Date.now();
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (typeof entry.ts === "string") {
          const ts = Date.parse(entry.ts);
          if (!Number.isNaN(ts) && now - ts <= graceMs) return true;
        }
      } catch {
        // Ignore malformed lines
      }
    }
    return false;
  }

  /**
   * Issue #134: the permanently-stuck Tier C queue that `llm_reachability`'s liveness ping
   *  structurally can't see -- `checkAvailability()`'s GET on the bare baseUrl can PASS while the
   *  completions route `analyze`'s drain dials is dead, leaving a non-empty queue draining to
   *  zero progress forever (issue #134's `processed: 0` evidence). FAILs when the queue is
   *  non-empty AND the most recent `tierC.summary` in `analyze.log` shows zero processed (or no
   *  summary ever exists -- never drained at all). A missing/unopenable db degrades to silently
   *  skipped, never a doctor crash.
   */
  private async runTierCQueueDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.GraphStoreOpener)) return true;

    let store: IGraphStore | undefined;
    try {
      const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
      store = await openStore({
        dbPath: resolveDbPath(this.workspaceRoot),
        readonly: true,
      });

      const queued = readTierCQueue(store).length;
      if (queued === 0) {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.TIER_C_QUEUE] = {
          status: DiagnosticStatus.PASS,
          message: DOCTOR_MESSAGES.TIER_C_QUEUE_OK(0, 0),
        };
        return true;
      }

      const lastDrain = await this.readLastTierCDrainOutcome();
      if (!lastDrain) {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.TIER_C_QUEUE] = {
          status: DiagnosticStatus.FAIL,
          message: DOCTOR_MESSAGES.TIER_C_QUEUE_NEVER_DRAINED(queued),
          suggestion: DOCTOR_MESSAGES.TIER_C_QUEUE_NEVER_DRAINED_SUGGESTION,
        };
        return false;
      }
      if (lastDrain.processed === 0) {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.TIER_C_QUEUE] = {
          status: DiagnosticStatus.FAIL,
          message: DOCTOR_MESSAGES.TIER_C_QUEUE_STUCK(
            queued,
            lastDrain.reason ?? "unknown",
          ),
          suggestion: DOCTOR_MESSAGES.TIER_C_QUEUE_STUCK_SUGGESTION,
        };
        return false;
      }
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.TIER_C_QUEUE] = {
        status: DiagnosticStatus.PASS,
        message: DOCTOR_MESSAGES.TIER_C_QUEUE_OK(queued, lastDrain.processed),
      };
      return true;
    } catch {
      // db not found/unopenable (already covered by db_found's own FAIL) -- silently skipped,
      // never a doctor crash.
      return true;
    } finally {
      await store?.close();
    }
  }

  /** The last completed Tier C drain's outcome, parsed from `.docuvia/logs/analyze.log`: the most
   *  recent `tierC.summary` entry's `processed` count plus the last `tierC.item_failed` reason
   *  seen (so a bridge-unreachable queue reads as such). `undefined` when no summary has ever been
   *  written (never drained) or the log is missing/unreadable. Malformed lines are ignored. */
  private async readLastTierCDrainOutcome(): Promise<
    { processed: number; reason?: string } | undefined
  > {
    const logPath = path.join(
      this.workspaceRoot,
      DOCUVIA_DIR_NAME,
      DOCUVIA_LOGS_DIR_NAME,
      ANALYZE_LOG_FILE_NAME,
    );

    let content: string;
    try {
      content = await fs.readFile(logPath, UTF8_ENCODING);
    } catch {
      return undefined;
    }

    let lastSummary: { processed: number } | undefined;
    let lastFailureReason: string | undefined;
    for (const line of content.split("\n")) {
      try {
        const entry = JSON.parse(line);
        if (entry.event === ANALYZE_EVENTS.TIER_C_SUMMARY) {
          lastSummary = { processed: Number(entry.processed ?? 0) };
        } else if (
          entry.event === ANALYZE_EVENTS.TIER_C_ITEM_FAILED &&
          typeof entry.reason === "string"
        ) {
          lastFailureReason = entry.reason;
        }
      } catch {
        // Ignore malformed lines
      }
    }
    if (!lastSummary) return undefined;
    return { processed: lastSummary.processed, reason: lastFailureReason };
  }

  /**
   * Issue #135: L2 semantic coverage (% of `l2_nodes` rows carrying a non-empty `description`) --
   *  the gap `graph_empty` (count-only) can't see: a graph can be fully ingested yet semantically
   *  empty (0/6285 in issue #135's live state), so `query` returns exact matches with zero
   *  content. FAILs below `DEFAULT_L2_SEMANTIC_COVERAGE_FAIL_THRESHOLD` only when Tier C is
   *  configured (`llmBaseUrl`) -- an AST-only graph with no LLM enrichment configured is
   *  structural-only by design, reported as a visible PASS, not a defect. A missing/unopenable db
   *  degrades to silently skipped, never a doctor crash.
   */
  private async runL2SemanticCoverageDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
    llmBaseUrl: string | undefined,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.GraphStoreOpener)) return true;

    let store: IGraphStore | undefined;
    try {
      const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
      store = await openStore({
        dbPath: resolveDbPath(this.workspaceRoot),
        readonly: true,
      });

      const { totalNodes, describedNodes } = store.graph.getSemanticCoverage();
      const coverage = totalNodes > 0 ? describedNodes / totalNodes : 1;
      const belowThreshold =
        coverage < GitConstants.DEFAULT_L2_SEMANTIC_COVERAGE_FAIL_THRESHOLD;
      // A structural-only graph (Tier C not configured -- empty-string env counts as not
      // configured, same falsy test as the message branch above) is a legitimate state, not a
      // defect -- FAIL only when the LLM enrichment pass is configured yet descriptions never
      // materialized.
      const tierCConfigured = Boolean(llmBaseUrl);

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.L2_SEMANTIC_COVERAGE] = belowThreshold
        ? tierCConfigured
          ? {
              status: DiagnosticStatus.FAIL,
              message: DOCTOR_MESSAGES.L2_SEMANTIC_COVERAGE_LOW(
                describedNodes,
                totalNodes,
                coverage * 100,
              ),
              suggestion: DOCTOR_MESSAGES.L2_SEMANTIC_COVERAGE_LOW_SUGGESTION,
            }
          : {
              status: DiagnosticStatus.PASS,
              message: DOCTOR_MESSAGES.L2_SEMANTIC_COVERAGE_STRUCTURAL_ONLY(
                describedNodes,
                totalNodes,
              ),
            }
        : {
            status: DiagnosticStatus.PASS,
            message: DOCTOR_MESSAGES.L2_SEMANTIC_COVERAGE_OK(
              describedNodes,
              totalNodes,
            ),
          };
      return !(belowThreshold && tierCConfigured);
    } catch {
      // db not found/unopenable (already covered by db_found's own FAIL) -- silently skipped,
      // never a doctor crash.
      return true;
    } finally {
      await store?.close();
    }
  }

  /**
   * Issue #137: per-worktree knowledge-graph fragmentation -- this repo's dev flow is heavily
   *  worktree-based, and every worktree gets its own `.docuvia/local.db` with no reconciliation
   *  story. FAILs when a sibling worktree (a `git worktree list` entry whose path isn't this
   *  workspace) carries its own `.docuvia/local.db`. A missing git provider, a non-repo, or any
   *  git-command failure degrades to silently skipped, never a doctor crash.
   */
  private async runWorktreeDivergenceDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.GitProvider)) return true;

    try {
      const git = docuviaFactory.resolve(TOKENS.GitProvider);
      const worktrees = await git.listWorktrees(this.workspaceRoot);
      const thisRoot = path.resolve(this.workspaceRoot);

      const divergent: string[] = [];
      for (const worktree of worktrees) {
        if (path.resolve(worktree.path) === thisRoot) continue;
        const dbPath = path.join(
          worktree.path,
          DOCUVIA_DIR_NAME,
          LOCAL_DB_FILE_NAME,
        );
        const stat = await fs.stat(dbPath).catch(() => null);
        if (stat) divergent.push(worktree.path);
      }

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.WORKTREE_DIVERGENCE] =
        divergent.length > 0
          ? {
              status: DiagnosticStatus.FAIL,
              message: DOCTOR_MESSAGES.WORKTREE_DIVERGENCE_FAIL(
                divergent.length,
                divergent,
              ),
              suggestion: DOCTOR_MESSAGES.WORKTREE_DIVERGENCE_SUGGESTION,
            }
          : {
              status: DiagnosticStatus.PASS,
              message: DOCTOR_MESSAGES.WORKTREE_DIVERGENCE_OK(worktrees.length),
            };
      return divergent.length === 0;
    } catch {
      return true;
    }
  }

  /**
   * Issue #139: docuvia-first workflow adoption -- always PASS (informational/soft, mirroring
   *  `TIER_B_COMMIT_CAP`'s always-PASS precedent) but the message carries the numbers that make a
   *  near-zero-adoption state visible: how many decisions are staged pending flush, how many
   *  agent-authored L3 rows exist in the graph, and how many files changed since the last
   *  ingestion carry no staged decision. Needs both the db (meta + L3 counts) and git
   *  (recently-changed files), so it's gated on `skipDb || skipGit`. A missing/unopenable db or a
   *  git-command failure degrades to silently skipped, never a doctor crash.
   */
  private async runAgentAuthoredAdoptionDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.GraphStoreOpener)) return true;
    if (!docuviaFactory.has(TOKENS.GitProvider)) return true;

    let store: IGraphStore | undefined;
    try {
      const git = docuviaFactory.resolve(TOKENS.GitProvider);
      const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
      store = await openStore({
        dbPath: resolveDbPath(this.workspaceRoot),
        readonly: true,
      });

      const headSha = await git.getHeadSha(this.workspaceRoot);
      const lastIngestedSha = store.meta.get(
        GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      );
      const changedFiles =
        lastIngestedSha && lastIngestedSha !== headSha
          ? await git.getChangedFilesSince(this.workspaceRoot, lastIngestedSha)
          : [];

      if (changedFiles.length === 0) {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.AGENT_AUTHED_ADOPTION] = {
          status: DiagnosticStatus.PASS,
          message: DOCTOR_MESSAGES.AGENT_AUTHED_ADOPTION_SKIPPED,
        };
        return true;
      }

      const pending = await readPendingDecisions(
        this.workspaceRoot,
        this.logger,
      );
      const stagedKeys = new Set(pending.map((d) => d.filePath));
      const agentAuthoredL3 = store.l3
        .getAllExportable()
        .filter(
          (row) => row.source === L3DecisionSources.AGENT_AUTHORED,
        ).length;
      const filesWithoutDecision = changedFiles.filter(
        (c) => !stagedKeys.has(c.file),
      ).length;

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.AGENT_AUTHED_ADOPTION] = {
        status: DiagnosticStatus.PASS,
        message: DOCTOR_MESSAGES.AGENT_AUTHED_ADOPTION_OK(
          pending.length,
          changedFiles.length,
          filesWithoutDecision,
          agentAuthoredL3,
        ),
      };
      return true;
    } catch {
      return true;
    } finally {
      await store?.close();
    }
  }

  /**
   * Issue #221: Tier A call-graph resolution health -- reads the per-file call-site resolution
   * counters the ingestion workflows stamp under `META_KEY_CALL_RESOLUTION_STATS` and reports
   * `resolved / (total - selfDiscarded)` as an informational diagnostic. Always PASS for now
   * (mirroring `TIER_B_COMMIT_CAP`'s always-PASS precedent): the rate conflates method-call
   * style with real resolution gaps until #192 fixes the constructor-call extraction blind
   * spot, so failing the build on it would encode an untuned baseline as a defect. A missing/
   * unopenable db or absent meta key (never analyzed) degrades to a visible PASS-with-no-data
   * / silently skipped respectively, never a doctor crash.
   */
  private async runCallGraphResolutionDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.GraphStoreOpener)) return true;

    let store: IGraphStore | undefined;
    try {
      const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
      store = await openStore({
        dbPath: resolveDbPath(this.workspaceRoot),
        readonly: true,
      });

      const { byFile, total } = aggregateStoredCallResolution(store);
      const files = Object.keys(byFile).length;

      if (files === 0 || total.total === 0) {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.CALL_GRAPH_RESOLUTION] = {
          status: DiagnosticStatus.PASS,
          message: DOCTOR_MESSAGES.CALL_GRAPH_RESOLUTION_NO_DATA,
        };
        return true;
      }

      // Every structural exclusion (self-calls, #192's unnameable shapes, #230's provably
      // external and unknown-receiver sites) lives in one shared helper so this diagnostic and
      // the persister's own rollup can never disagree about what the rate means.
      const applicable = callResolutionDenominator(total);
      const rate = applicable > 0 ? total.resolved / applicable : 1;
      const belowThreshold =
        rate < GitConstants.DEFAULT_CALL_RESOLUTION_NOTE_THRESHOLD;

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.CALL_GRAPH_RESOLUTION] = belowThreshold
        ? {
            status: DiagnosticStatus.PASS,
            message: DOCTOR_MESSAGES.CALL_GRAPH_RESOLUTION_LOW(
              total.resolved,
              applicable,
              rate * 100,
              files,
            ),
            suggestion: DOCTOR_MESSAGES.CALL_GRAPH_RESOLUTION_LOW_SUGGESTION,
          }
        : {
            status: DiagnosticStatus.PASS,
            message: DOCTOR_MESSAGES.CALL_GRAPH_RESOLUTION_OK(
              total.resolved,
              applicable,
              files,
            ),
          };
      return true;
    } catch {
      // db not found/unopenable (already covered by db_found's own FAIL) -- degrades to
      // silently skipped, never a doctor crash.
      return true;
    } finally {
      await store?.close();
    }
  }

  /** `!skipDb` branch of `execute` — checks the local db exists and (if so) delegates to the
   *  registered `DiagnosticRunnerDb`. Returns whether every db diagnostic passed. */
  private async runDbDiagnostics(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    const dbPath = path.join(
      this.workspaceRoot,
      DOCUVIA_DIR_NAME,
      LOCAL_DB_FILE_NAME,
    );
    const hasDb = await fs.stat(dbPath).catch(() => null);

    if (!hasDb) {
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.DB_FOUND] = {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.DB_NOT_FOUND_AT(dbPath),
      };
      return false;
    }

    if (!docuviaFactory.has(TOKENS.DiagnosticRunnerDb)) {
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.DB_RUNNER] = {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.DB_RUNNER_NOT_REGISTERED,
      };
      return false;
    }

    const dbRunner = docuviaFactory.resolve(TOKENS.DiagnosticRunnerDb);
    const dbResults = await dbRunner.checkHealth(dbPath);
    return this.mergeDiagnosticResults(diagnostics, dbResults);
  }

  /** `!skipGit` branch of `execute` — delegates to the registered `DiagnosticRunnerGit`,
   *  translating a thrown error into a single FAIL diagnostic. Returns whether every git
   *  diagnostic passed. */
  private async runGitDiagnostics(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    if (!docuviaFactory.has(TOKENS.DiagnosticRunnerGit)) {
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.GIT_RUNNER] = {
        status: DiagnosticStatus.FAIL,
        message: DOCTOR_MESSAGES.GIT_RUNNER_NOT_REGISTERED,
      };
      return false;
    }

    try {
      const gitRunner = docuviaFactory.resolve(TOKENS.DiagnosticRunnerGit, {
        logger: this.logger,
      });
      const gitResults = await gitRunner.checkHealth(this.workspaceRoot);
      return this.mergeDiagnosticResults(diagnostics, gitResults);
    } catch (error: unknown) {
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.GIT_REACHABILITY] =
        this.buildGitReachabilityFailure(error);
      return false;
    }
  }

  /** Merges runner results into `diagnostics` and reports whether all of them passed — shared
   *  by `runDbDiagnostics` and `runGitDiagnostics`. */
  private mergeDiagnosticResults(
    diagnostics: Record<string, DiagnosticResult>,
    results: Record<string, DiagnosticResult>,
  ): boolean {
    let passed = true;
    for (const [key, res] of Object.entries(results)) {
      diagnostics[key] = res;
      if (res.status === DiagnosticStatus.FAIL) passed = false;
    }
    return passed;
  }

  /** Builds the FAIL `DiagnosticResult` for a `DiagnosticRunnerGit.checkHealth` rejection,
   *  attaching a targeted suggestion for known `DocuviaError` codes/messages. */
  private buildGitReachabilityFailure(error: unknown): DiagnosticResult {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);

    let suggestion = undefined;
    if (error instanceof DocuviaError) {
      if (error.code === ErrorCodes.GIT_NETWORK_TIMEOUT) {
        suggestion = DOCTOR_MESSAGES.GIT_NETWORK_TIMEOUT_SUGGESTION;
      } else if (
        error.code === ErrorCodes.GIT_COMMAND_FAILED &&
        message.includes(DOCTOR_MESSAGES.GIT_NOT_A_REPO_TEXT)
      ) {
        suggestion = DOCTOR_MESSAGES.GIT_NOT_A_REPO_SUGGESTION;
      } else if (
        error.code === ErrorCodes.GIT_COMMAND_FAILED &&
        message.includes(DOCTOR_MESSAGES.GIT_REMOTE_UNREADABLE_TEXT)
      ) {
        suggestion = DOCTOR_MESSAGES.GIT_REMOTE_UNREADABLE_SUGGESTION;
      }
    }

    return {
      status: DiagnosticStatus.FAIL,
      message: DOCTOR_MESSAGES.GIT_REACHABILITY_FAILED(message),
      suggestion,
    };
  }

  /** `!skipLogs` branch of `execute` — scans `.docuvia/logs/*.log` for error-level entries.
   *  A missing log directory is treated as PASS (nothing to check), matching prior behavior. */
  private async runLogsDiagnostics(
    diagnostics: Record<string, DiagnosticResult>,
  ): Promise<boolean> {
    const logPath = path.join(
      this.workspaceRoot,
      DOCUVIA_DIR_NAME,
      DOCUVIA_LOGS_DIR_NAME,
    );

    try {
      const { errorsFound, logsChecked } = await this.scanLogFiles(logPath);
      if (errorsFound > 0) {
        diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LOGS] = {
          status: DiagnosticStatus.FAIL,
          message: DOCTOR_MESSAGES.LOGS_ERRORS_FOUND(errorsFound),
          suggestion: DOCTOR_MESSAGES.LOGS_ERRORS_FOUND_SUGGESTION,
        };
        return false;
      }
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LOGS] = {
        status: DiagnosticStatus.PASS,
        message: DOCTOR_MESSAGES.LOGS_CHECKED_CLEAN(logsChecked),
      };
      return true;
    } catch {
      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.LOGS] = {
        status: DiagnosticStatus.PASS,
        message: DOCTOR_MESSAGES.LOGS_NOT_FOUND_AT(logPath),
      };
      return true;
    }
  }

  /** Reads every `LOG_FILE_EXTENSION` file under `logPath` and counts newline-delimited JSON
   *  entries with `level >= 50`, ignoring malformed lines — the counting core of
   *  `runLogsDiagnostics`. */
  private async scanLogFiles(
    logPath: string,
  ): Promise<{ errorsFound: number; logsChecked: number }> {
    let errorsFound = 0;
    let logsChecked = 0;
    const logs = await fs.readdir(logPath);
    for (const log of logs) {
      if (!log.endsWith(LOG_FILE_EXTENSION)) continue;
      logsChecked++;
      const content = await fs.readFile(path.join(logPath, log), UTF8_ENCODING);
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.level && entry.level >= 50) {
            errorsFound++;
          }
        } catch {
          // Ignore malformed JSON
        }
      }
    }
    return { errorsFound, logsChecked };
  }
}
