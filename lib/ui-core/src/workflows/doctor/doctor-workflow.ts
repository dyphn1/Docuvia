import {
  docuviaFactory,
  TOKENS,
  DOCUVIA_DIR_NAME,
  DOCUVIA_LOGS_DIR_NAME,
  LOCAL_DB_FILE_NAME,
  DocuviaError,
  ErrorCodes,
  UTF8_ENCODING,
  type ILogger,
  type IGraphStore,
  type IGitProvider,
  type DiagnosticResult,
  DiagnosticStatus,
} from "@workspace/contracts";
import {
  CLAUDE_HOOKS_DIR,
  CURSOR_HOOKS_DIR,
  DOCUVIA_HOOK_JS_FILENAME,
  DOCUVIA_HOOK_CJS_FILENAME,
} from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
import type { DoctorResult } from "./doctor-result.js";
import {
  DOCTOR_AGENT_PLATFORM_NAMES,
  DOCTOR_DIAGNOSTIC_KEYS,
  DOCTOR_MESSAGES,
  LOG_FILE_EXTENSION,
} from "./doctor-messages.js";
import { isTierBCommitCapExceeded } from "../analyze/tier-b-commit-cap.js";
import { resolveQueuedLanguages } from "../analyze/tier-b-gate.js";
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
  /** Opt-in repair of the legacy-hook duplicate-block case (§10d, T6) -- the only `doctor` flag
   *  that mutates workspace files, and only for that one specific condition. Never mutates
   *  anything when absent/false. */
  fix?: boolean;
  /** §10e bullet 3 (T7) -- the Tier C CLIProxyAPI endpoint's `baseUrl`/`apiKey`, read from
   *  `process.env` by the Presentation layer (`doctor.ts`) and threaded through here. Absence is
   *  a normal, non-error `doctor` state (Tier C inactive by choice) -- unlike `analyze
   *  <targetPath>`'s hard requirement. */
  llmBaseUrl?: string;
  llmApiKey?: string;
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
        this.runPrePushHookDiagnostic(diagnostics),
      ),
      await this.runOrSkip(skipLlm, () =>
        this.runLlmReachabilityDiagnostic(diagnostics, llmBaseUrl, llmApiKey),
      ),
      await this.runOrSkip(skipLsp, () =>
        this.runLspBinaryDiagnostic(diagnostics),
      ),
      await this.runOrSkip(skipDb, () =>
        this.runTierBCoverageDiagnostic(diagnostics),
      ),
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

      let result = await this.classifyGitHookState(git, hasCurrent, hasLegacy);
      if (fix && hasCurrent && hasLegacy) {
        result = await this.repairDuplicateGitHookIfRequested(result);
      }

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.GIT_HOOK] = result;
      return result.status === DiagnosticStatus.PASS;
    } catch {
      return true;
    }
  }

  /** The marker-based branches of `runGitHookDiagnostic`, plus (only for the healthy-shaped
   *  case) the live resolvability probe -- split out to keep `runGitHookDiagnostic` itself under
   *  the ESLint complexity budget. */
  private async classifyGitHookState(
    git: IGitProvider,
    hasCurrent: boolean,
    hasLegacy: boolean,
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
   * exact-content-match replace, not append, so re-running `docuvia init` is the fix -- no
   * dedicated `--fix` repair method needed. A healthy-shaped hook still gets the same
   * `probeDocuviaResolvable` live check `runGitHookDiagnostic`'s post-commit case already runs --
   * found missing here via dogfooding this exact hook on Docuvia2 itself (2026-07-21): a pre-push
   * hook can be perfectly up to date and still silently no-op every push if `docuvia` itself isn't
   * `npx --no-install`-resolvable, and content-only marker checks can't see that. Never throws
   * past this method.
   */
  private async runPrePushHookDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
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

      let result: DiagnosticResult;
      if (!hasCurrent) {
        result = {
          status: DiagnosticStatus.PASS,
          message: DOCTOR_MESSAGES.PRE_PUSH_HOOK_NOT_INSTALLED,
        };
      } else if (!hasSyncKnowledge) {
        result = {
          status: DiagnosticStatus.FAIL,
          message: DOCTOR_MESSAGES.PRE_PUSH_HOOK_STALE,
          suggestion: DOCTOR_MESSAGES.PRE_PUSH_HOOK_STALE_SUGGESTION,
        };
      } else if (!hasEnvGate) {
        result = {
          status: DiagnosticStatus.FAIL,
          message: DOCTOR_MESSAGES.PRE_PUSH_HOOK_ENV_GATE_STALE,
          suggestion: DOCTOR_MESSAGES.PRE_PUSH_HOOK_STALE_SUGGESTION,
        };
      } else {
        const resolvable = await probeDocuviaResolvable(this.workspaceRoot);
        if (resolvable) {
          const hooksDir = await git.resolveHooksDir(this.workspaceRoot);
          result = {
            status: DiagnosticStatus.PASS,
            message: DOCTOR_MESSAGES.PRE_PUSH_HOOK_OK(
              path.join(hooksDir, GitConstants.PRE_PUSH_HOOK_NAME),
            ),
          };
        } else {
          result = {
            status: DiagnosticStatus.FAIL,
            message: DOCTOR_MESSAGES.PRE_PUSH_HOOK_NOT_RESOLVABLE,
            suggestion: DOCTOR_MESSAGES.GIT_HOOK_NOT_RESOLVABLE_SUGGESTION,
          };
        }
      }

      diagnostics[DOCTOR_DIAGNOSTIC_KEYS.PRE_PUSH_HOOK] = result;
      return result.status === DiagnosticStatus.PASS;
    } catch {
      return true;
    }
  }

  /**
   * §10e bullet 3 (T7): a real reachability pre-flight probe for the Tier C CLIProxyAPI endpoint,
   * via `ILlmClient.checkAvailability()` (decision 1e: reachability, not correctness). No base
   * URL supplied is a normal, non-error `doctor` state (decision 1c) -- `PASS`, "not configured."
   * Configured-but-unreachable is the one real defect this check reports -- `FAIL`. Never throws
   * past this method.
   */
  private async runLlmReachabilityDiagnostic(
    diagnostics: Record<string, DiagnosticResult>,
    llmBaseUrl: string | undefined,
    llmApiKey: string | undefined,
  ): Promise<boolean> {
    if (!llmBaseUrl) {
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
      const availability = await llmClient.checkAvailability();

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
