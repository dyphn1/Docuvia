import process from "process";
import crypto from "node:crypto";
import {
  docuviaMemory,
  DocuviaError,
  MemoryKeys,
  LogLevels,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import "../registration.js";
import { ui } from "../ui/wizard.js";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { OUTPUT_FORMAT_MARKERS } from "../constants/cli-output-markers.js";

/**
 * Mirrors `AnalyzeResultKind` from `lib/ui-core`'s `analyze-result.ts` — not re-exported
 * through `@workspace/ui-core`'s barrel, so the discriminant values are duplicated here rather
 * than imported (only the `AnalyzeResult` type crosses that boundary today).
 */
const ANALYZE_RESULT_KIND = {
  AUTO_FULL_INGESTION: "autoFullIngestion",
  AUTO_DELTA: "autoDelta",
  AUTO_DELTA_NOOP: "autoDeltaNoop",
  DECISION_EXTRACTION: "decisionExtraction",
  TIER_B_BATCH: "tierBBatch",
} as const;

type AnalyzeResult = Awaited<ReturnType<typeof docuviaApi.analyze>>;
type AnalyzeSpinner = ReturnType<typeof ui.spinner>;

export interface AnalyzeCommandOptions {
  /** `--escalate-to-lsp` (PLAT-007 Tier B; phase1-decision-integration.md §8). Ignored when
   *  `targetPath` is also given -- focused decision extraction takes priority. */
  escalateToLsp?: boolean;
  /** `--fallback-ast` -- skips D2's interactive gate prompt entirely (§8c), proceeding straight
   *  to the honest-degradation path if LSP isn't ready. */
  fallbackAst?: boolean;
  /** `--interactive`/`-i` (IFCE-004) -- opt-in signal that D2's Tier B gate prompt (§8c) is
   *  allowed to fire. Without it, an unready LSP always degrades honestly with no prompt. */
  isInteractive?: boolean;
  force?: boolean;
  /** `--lsp-timeout=` -- takes precedence over `DOCUVIA_LSP_TIMEOUT_MS` (see
   *  `resolveTierBEnvConfig`). `0` means "never time out". */
  lspTimeoutMs?: number;
  /** `--lsp-processes=` -- takes precedence over `DOCUVIA_LSP_MAX_PROCESSES`. Number of
   *  independent LSP server processes to shard the Tier B batch across (default `1`). */
  lspProcesses?: number;
  /** `--full` (typescript-cli-benchmark.md §5.3/§5.7 item 1) -- pre-populates `tierBQueue` with
   *  every currently-tracked file before the batch drains it. Ignored when `escalateToLsp` is not
   *  also set. */
  full?: boolean;
}

interface AnalyzeLlmConfig {
  llmBaseUrl: string;
  llmApiKey: string | undefined;
  llmModel: string;
}

/** Reads the LLM env vars required for focused (`targetPath`) analysis; `null` when incomplete. */
function resolveAnalyzeLlmConfig(): AnalyzeLlmConfig | null {
  const llmBaseUrl = process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL;
  const llmApiKey = process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_API_KEY;
  const llmModel =
    process.env.AI_DOCUVIA_MODEL || process.env.AI_DOCUVIA_FAST_MODEL;

  if (!llmBaseUrl || !llmModel) return null;
  return { llmBaseUrl, llmApiKey, llmModel };
}

interface TierBEnvConfig {
  lspBinaryOverride: string | undefined;
  lspArgsOverride: string[] | undefined;
  lspTimeoutMs: number | undefined;
  lspMaxProcesses: number | undefined;
  tierBCommitCap: number | undefined;
}

interface TierCEnvConfig {
  dailyCallCap: number | undefined;
  dailyTokenCap: number | undefined;
  wallClockMs: number | undefined;
  itemCap: number | undefined;
  loadThreshold: number | undefined;
}

/** §9c/§9d/§9f's config-tunable Tier C overrides, read once from `process.env` here
 *  (Presentation layer only) and injected via `docuviaMemory` -- mirrors
 *  `resolveTierBEnvConfig`'s shape. */
function resolveTierCEnvConfig(): TierCEnvConfig {
  const dailyCallCapRaw = process.env.DOCUVIA_TIER_C_DAILY_CALL_CAP;
  const dailyTokenCapRaw = process.env.DOCUVIA_TIER_C_DAILY_TOKEN_CAP;
  const wallClockMsRaw = process.env.DOCUVIA_TIER_C_WALL_CLOCK_MS;
  const itemCapRaw = process.env.DOCUVIA_TIER_C_ITEM_CAP;
  const loadThresholdRaw = process.env.DOCUVIA_TIER_C_LOAD_THRESHOLD;
  return {
    dailyCallCap: dailyCallCapRaw ? Number(dailyCallCapRaw) : undefined,
    dailyTokenCap: dailyTokenCapRaw ? Number(dailyTokenCapRaw) : undefined,
    wallClockMs: wallClockMsRaw ? Number(wallClockMsRaw) : undefined,
    itemCap: itemCapRaw ? Number(itemCapRaw) : undefined,
    loadThreshold: loadThresholdRaw ? Number(loadThresholdRaw) : undefined,
  };
}

/** §8b "config-overridable" LSP binary/args/timeout, plus §8f's commit-cap override -- read once
 *  from `process.env` here (Presentation layer only, per
 *  docs/gitbook/architecture/application-lifecycle-and-state.md) and injected via
 *  `docuviaMemory`. `cliLspTimeoutMs` (from `--lsp-timeout=`) takes precedence over
 *  `DOCUVIA_LSP_TIMEOUT_MS` when both are given -- an explicit flag on this invocation should win
 *  over an ambient env var. Same precedence applies to `--lsp-processes=` /
 *  `DOCUVIA_LSP_MAX_PROCESSES`. */
function resolveTierBEnvConfig(
  cliLspTimeoutMs?: number,
  cliLspProcesses?: number,
): TierBEnvConfig {
  const lspArgsRaw = process.env.DOCUVIA_LSP_ARGS;
  const timeoutRaw = process.env.DOCUVIA_LSP_TIMEOUT_MS;
  const processesRaw = process.env.DOCUVIA_LSP_MAX_PROCESSES;
  const capRaw = process.env.DOCUVIA_TIER_B_COMMIT_CAP;
  return {
    lspBinaryOverride: process.env.DOCUVIA_LSP_BINARY,
    lspArgsOverride: lspArgsRaw
      ? lspArgsRaw.split(" ").filter(Boolean)
      : undefined,
    lspTimeoutMs:
      cliLspTimeoutMs ?? (timeoutRaw ? Number(timeoutRaw) : undefined),
    lspMaxProcesses:
      cliLspProcesses ?? (processesRaw ? Number(processesRaw) : undefined),
    tierBCommitCap: capRaw ? Number(capRaw) : undefined,
  };
}

function printAutoFullIngestionResult(
  result: Extract<
    AnalyzeResult,
    { kind: typeof ANALYZE_RESULT_KIND.AUTO_FULL_INGESTION }
  >,
  spinner: AnalyzeSpinner,
): void {
  spinner.succeed(UI_MESSAGES.ANALYZE_AUTO_FULL_SUCCESS);
  ui.info(UI_MESSAGES.ANALYZE_PROJECT_TYPE + result.projectType);
  ui.info(
    UI_MESSAGES.ANALYZE_SUGGESTED_TAGS +
      (result.suggestedTags.join(", ") || UI_MESSAGES.ANALYZE_NONE),
  );
  ui.info(
    UI_MESSAGES.ANALYZE_AUTO_FULL_SUMMARY(
      result.filesParsed,
      result.filesRequested,
      result.filesFailed,
    ),
  );
}

function printAutoDeltaResult(
  result: Extract<
    AnalyzeResult,
    { kind: typeof ANALYZE_RESULT_KIND.AUTO_DELTA }
  >,
  spinner: AnalyzeSpinner,
): void {
  spinner.succeed(UI_MESSAGES.ANALYZE_AUTO_DELTA_SUCCESS);
  ui.info(
    UI_MESSAGES.ANALYZE_AUTO_DELTA_SUMMARY(
      result.filesReparsed,
      result.filesDeleted,
      result.tierBQueued,
    ),
  );
}

function printFocusedResult(
  result: Extract<
    AnalyzeResult,
    { kind: typeof ANALYZE_RESULT_KIND.DECISION_EXTRACTION }
  >,
  spinner: AnalyzeSpinner,
): void {
  spinner.succeed(UI_MESSAGES.ANALYZE_FOCUSED_SUCCESS);
  if (result.decisions.length === 0) {
    ui.info(UI_MESSAGES.ANALYZE_FOCUSED_NONE);
    return;
  }
  for (const decision of result.decisions) {
    ui.info(
      UI_MESSAGES.ANALYZE_DECISION_LINE(
        decision.nodeType,
        decision.title,
        decision.confidence,
      ),
    );
    if (decision.content) {
      ui.log(UI_MESSAGES.ANALYZE_DECISION_CONTENT_PREFIX + decision.content);
    }
  }
  ui.info(
    UI_MESSAGES.ANALYZE_FOCUSED_PERSISTED(result.persisted, result.deduped),
  );
}

function printTierBBatchResult(
  result: Extract<
    AnalyzeResult,
    { kind: typeof ANALYZE_RESULT_KIND.TIER_B_BATCH }
  >,
  spinner: AnalyzeSpinner,
  fallbackAst: boolean,
): void {
  if (result.degraded) {
    spinner.succeed(
      UI_MESSAGES.ANALYZE_TIER_B_DEGRADED(result.degradedReason ?? ""),
    );
    // Runtime degradation (gate passed, then the LSP crashed/timed out mid-batch) must be as
    // visible to the exit code as a gate-time failure is (process.exitCode = 1 at
    // ANALYZE_TIER_B_GATE_FAILED above) -- otherwise a direct, non-hook `analyze --escalate-to-lsp`
    // whose LSP dies mid-run exits 0, indistinguishable from a real success at the shell level
    // (2026-07 CLI benchmark finding, live-reproduced against nestjs/nest). `--fallback-ast` is
    // excluded: it's the pre-push hook's own invocation, whose entire contract is "git push must
    // never be blocked by an unready LSP environment" -- that flag skips the gate specifically so
    // the batch can degrade honestly without failing the caller, so it must keep exiting 0 here too.
    if (!fallbackAst) process.exitCode = 1;
  } else {
    spinner.succeed(UI_MESSAGES.ANALYZE_TIER_B_SUCCESS);
    ui.info(
      UI_MESSAGES.ANALYZE_TIER_B_SUMMARY(
        result.filesProcessed,
        result.edgesApplied,
        result.filesFailed,
        result.filesFailedPermanent,
        Boolean(result.zeroProgressWatchdogTripped),
      ),
    );
  }
  printTierCSummary(result);
}

/** Tier C's drain summary (§9), appended after Tier B's own -- no separate spinner/header. */
function printTierCSummary(
  result: Extract<
    AnalyzeResult,
    { kind: typeof ANALYZE_RESULT_KIND.TIER_B_BATCH }
  >,
): void {
  if (result.tierCQueued === 0) return;
  if (result.tierCSkipped) {
    ui.info(
      UI_MESSAGES.ANALYZE_TIER_C_SKIPPED(result.tierCSkippedReason ?? ""),
    );
    return;
  }
  ui.info(
    UI_MESSAGES.ANALYZE_TIER_C_SUMMARY(
      result.tierCProcessed,
      result.tierCPersisted,
      result.tierCFailed,
    ),
  );
}

function printAnalyzeResult(
  result: AnalyzeResult,
  spinner: AnalyzeSpinner,
  fallbackAst: boolean,
): void {
  switch (result.kind) {
    case ANALYZE_RESULT_KIND.AUTO_FULL_INGESTION:
      printAutoFullIngestionResult(result, spinner);
      break;
    case ANALYZE_RESULT_KIND.AUTO_DELTA:
      printAutoDeltaResult(result, spinner);
      break;
    case ANALYZE_RESULT_KIND.AUTO_DELTA_NOOP:
      spinner.succeed(
        result.dirtyWorktree
          ? UI_MESSAGES.ANALYZE_AUTO_NOOP_DIRTY_WORKTREE_SUCCESS
          : UI_MESSAGES.ANALYZE_AUTO_NOOP_SUCCESS,
      );
      break;
    case ANALYZE_RESULT_KIND.DECISION_EXTRACTION:
      printFocusedResult(result, spinner);
      break;
    case ANALYZE_RESULT_KIND.TIER_B_BATCH:
      printTierBBatchResult(result, spinner, fallbackAst);
      break;
  }
}

function startAnalyzeSpinner(
  targetPath: string | undefined,
  escalateToLsp: boolean,
): AnalyzeSpinner {
  ui.header(
    targetPath
      ? UI_MESSAGES.ANALYZE_FOCUSED_HEADER
      : escalateToLsp
        ? UI_MESSAGES.ANALYZE_TIER_B_HEADER
        : UI_MESSAGES.ANALYZE_HEADER,
  );
  return ui
    .spinner(
      targetPath
        ? UI_MESSAGES.ANALYZE_FOCUSED_START +
            targetPath +
            OUTPUT_FORMAT_MARKERS.ELLIPSIS
        : escalateToLsp
          ? UI_MESSAGES.ANALYZE_TIER_B_START
          : UI_MESSAGES.ANALYZE_START,
    )
    .start();
}

function setupAnalyzeMemory(
  scopeId: string,
  cwd: string,
  targetPath: string | undefined,
  llmConfig: AnalyzeLlmConfig | undefined,
  escalateToLsp: boolean,
  force?: boolean,
  lspTimeoutMs?: number,
  lspProcesses?: number,
  full?: boolean,
): void {
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  if (force) {
    docuviaMemory.set(scopeId, MemoryKeys.FORCE, true);
  }
  if (targetPath && llmConfig) {
    docuviaMemory.set(scopeId, MemoryKeys.TARGET_PATH, targetPath);
    docuviaMemory.set(scopeId, MemoryKeys.LLM_BASE_URL, llmConfig.llmBaseUrl);
    docuviaMemory.set(scopeId, MemoryKeys.LLM_API_KEY, llmConfig.llmApiKey);
    docuviaMemory.set(scopeId, MemoryKeys.LLM_MODEL, llmConfig.llmModel);
  } else if (escalateToLsp) {
    docuviaMemory.set(scopeId, MemoryKeys.ESCALATE_TO_LSP, true);
    if (full) {
      docuviaMemory.set(scopeId, MemoryKeys.TIER_B_FULL_RESYNC, true);
    }
    setTierBEnvMemory(scopeId, lspTimeoutMs, lspProcesses);
    setTierCMemory(scopeId);
  }
}

/** Tier C's LLM config (§9, folded into the same `--escalate-to-lsp` run) plus its own env
 *  overrides (§9c/§9d/§9f) -- optional here, unlike `targetPath` mode's hard-fail-on-missing-env,
 *  since a missing/incomplete bridge config just means Tier C's drain skips honestly this run. */
function setTierCMemory(scopeId: string): void {
  const llmConfig = resolveAnalyzeLlmConfig();
  if (llmConfig) {
    docuviaMemory.set(scopeId, MemoryKeys.LLM_BASE_URL, llmConfig.llmBaseUrl);
    docuviaMemory.set(scopeId, MemoryKeys.LLM_API_KEY, llmConfig.llmApiKey);
    docuviaMemory.set(scopeId, MemoryKeys.LLM_MODEL, llmConfig.llmModel);
  }

  const envConfig = resolveTierCEnvConfig();
  if (envConfig.dailyCallCap !== undefined) {
    docuviaMemory.set(
      scopeId,
      MemoryKeys.TIER_C_DAILY_CALL_CAP,
      envConfig.dailyCallCap,
    );
  }
  if (envConfig.dailyTokenCap !== undefined) {
    docuviaMemory.set(
      scopeId,
      MemoryKeys.TIER_C_DAILY_TOKEN_CAP,
      envConfig.dailyTokenCap,
    );
  }
  if (envConfig.wallClockMs !== undefined) {
    docuviaMemory.set(
      scopeId,
      MemoryKeys.TIER_C_WALL_CLOCK_MS,
      envConfig.wallClockMs,
    );
  }
  if (envConfig.itemCap !== undefined) {
    docuviaMemory.set(scopeId, MemoryKeys.TIER_C_ITEM_CAP, envConfig.itemCap);
  }
  if (envConfig.loadThreshold !== undefined) {
    docuviaMemory.set(
      scopeId,
      MemoryKeys.TIER_C_LOAD_THRESHOLD,
      envConfig.loadThreshold,
    );
  }
}

/** Injects §8b/§8f's env-var/CLI-flag overrides into `scopeId` -- shared by `setupAnalyzeMemory`
 *  and the gate-check scope in `analyzeCommand`. */
function setTierBEnvMemory(
  scopeId: string,
  cliLspTimeoutMs?: number,
  cliLspProcesses?: number,
): void {
  const envConfig = resolveTierBEnvConfig(cliLspTimeoutMs, cliLspProcesses);
  if (envConfig.lspBinaryOverride !== undefined) {
    docuviaMemory.set(
      scopeId,
      MemoryKeys.LSP_BINARY_OVERRIDE,
      envConfig.lspBinaryOverride,
    );
  }
  if (envConfig.lspArgsOverride !== undefined) {
    docuviaMemory.set(
      scopeId,
      MemoryKeys.LSP_ARGS_OVERRIDE,
      envConfig.lspArgsOverride,
    );
  }
  if (envConfig.lspTimeoutMs !== undefined) {
    docuviaMemory.set(
      scopeId,
      MemoryKeys.LSP_TIMEOUT_MS,
      envConfig.lspTimeoutMs,
    );
  }
  if (envConfig.lspMaxProcesses !== undefined) {
    docuviaMemory.set(
      scopeId,
      MemoryKeys.LSP_MAX_PROCESSES,
      envConfig.lspMaxProcesses,
    );
  }
  if (envConfig.tierBCommitCap !== undefined) {
    docuviaMemory.set(
      scopeId,
      MemoryKeys.TIER_B_COMMIT_CAP,
      envConfig.tierBCommitCap,
    );
  }
}

function handleAnalyzeError(
  error: unknown,
  targetPath: string | undefined,
  escalateToLsp: boolean,
  spinner: AnalyzeSpinner,
): void {
  const message =
    error instanceof DocuviaError || error instanceof Error
      ? error.message
      : String(error);
  const prefix = targetPath
    ? UI_MESSAGES.ANALYZE_FOCUSED_FAIL
    : escalateToLsp
      ? UI_MESSAGES.ANALYZE_TIER_B_FAIL
      : UI_MESSAGES.ANALYZE_FAIL;
  spinner.fail(prefix + message);
  // process.exitCode (not process.exit()) for both branches — the targetPath branch follows
  // a real network call (LLM chat completion); forcing an immediate exit while fetch/undici
  // handles are still closing crashes natively on Windows. See publish.ts's identical fix.
  process.exitCode = 1;
}

/**
 * D2's pre-flight gate for `analyze --escalate-to-lsp` (phase1-decision-integration.md §8c) --
 * called for every invocation that didn't opt out via `--fallback-ast` (see `analyzeCommand`'s
 * `!options.fallbackAst` guard), interactive or not. An interactive terminal (`-i`) gets the
 * original prompt (continue with AST-only precision?). A non-interactive one -- a human running
 * the bare command, or a benchmark/CI script -- now fails outright instead of silently degrading:
 * a silent degrade wastes a full batch's wall-clock time and produces a result indistinguishable
 * from a healthy run unless the caller reads the JSONL log line-by-line (2026-07 C#/TS benchmark
 * finding). The pre-push hook is the one caller that must never fail here -- it passes
 * `--fallback-ast` (see `PRE_PUSH_HOOK_CONTENT` in git-constants.ts), which skips this function
 * entirely and goes straight to the workflow's own honest-degradation path, unchanged from
 * before. Returns `false` when the batch should not run (interactive decline, or a non-interactive
 * hard failure -- the caller sets `process.exitCode` only for the latter).
 */
async function confirmTierBGateOrAbort(
  cwd: string,
  isInteractive: boolean,
  lspTimeoutMs?: number,
): Promise<boolean> {
  const scopeId = crypto.randomUUID();
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  setTierBEnvMemory(scopeId, lspTimeoutMs);

  try {
    const logger = createPinoBackedLogger();
    const availability = await docuviaApi.checkTierBGate(scopeId, logger);
    if (availability.available) return true;

    if (!isInteractive) {
      ui.error(
        UI_MESSAGES.ANALYZE_TIER_B_GATE_FAILED(availability.reason ?? ""),
      );
      process.exitCode = 1;
      return false;
    }

    ui.warn(
      UI_MESSAGES.ANALYZE_TIER_B_GATE_NOT_READY(availability.reason ?? ""),
    );
    const proceed = await ui.askConfirm(
      UI_MESSAGES.ANALYZE_TIER_B_GATE_PROMPT,
      true,
    );
    if (!proceed) ui.info(UI_MESSAGES.ANALYZE_TIER_B_GATE_DECLINED);
    return proceed;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}

/**
 * Thin caller of `docuviaApi.analyze()` — three modes (mutually exclusive; `targetPath` wins if
 * somehow both are given):
 * - No `targetPath`, no `--escalate-to-lsp`: auto mode (PLAT-007 Tier A;
 *   phase1-decision-integration.md §6) — a sha fast-path no-op, full ingestion (empty graph), or
 *   delta ingestion (non-empty graph, `HEAD` moved), each reported with its own
 *   `result.kind`-specific summary below.
 * - `targetPath` given: focused LLM decision extraction (mirrors old Docuvia's
 *   `runFocusedExtraction`/the old `extract` command). Requires
 *   `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` and a model
 *   (`AI_DOCUVIA_MODEL`/`AI_DOCUVIA_FAST_MODEL`) to be set; missing env vars are a hard failure
 *   (exit 1) rather than a silent skip — unlike `publish.ts`'s missing-env behavior — because a
 *   user who explicitly asked to analyze a path expects LLM extraction to actually run.
 * - `--escalate-to-lsp`: the Tier B batch (PLAT-007 Tier B; phase1-decision-integration.md §8) —
 *   a sibling mode, never combined with auto mode's own dispatch (it consumes the queue Tier A
 *   already accumulated, never re-runs Tier A itself). D2's gate (`confirmTierBGateOrAbort`) runs
 *   for every invocation without `--fallback-ast`: interactive gets a prompt, non-interactive now
 *   hard-fails on an unready environment instead of silently degrading. Only `--fallback-ast`
 *   (the pre-push hook's own invocation) skips the gate entirely, straight to the workflow's own
 *   honest-degradation path.
 */
export async function analyzeCommand(
  targetPath?: string,
  cwd: string = process.cwd(),
  options: AnalyzeCommandOptions = {},
) {
  let llmConfig: AnalyzeLlmConfig | undefined;
  const escalateToLsp = !targetPath && Boolean(options.escalateToLsp);

  if (targetPath) {
    const resolved = resolveAnalyzeLlmConfig();
    if (!resolved) {
      ui.error(UI_MESSAGES.ANALYZE_LLM_MISSING_ENV);
      process.exitCode = 1;
      return;
    }
    llmConfig = resolved;
  } else if (escalateToLsp && !options.fallbackAst) {
    const proceed = await confirmTierBGateOrAbort(
      cwd,
      Boolean(options.isInteractive),
      options.lspTimeoutMs,
    );
    if (!proceed) return;
  }

  const spinner = startAnalyzeSpinner(targetPath, escalateToLsp);
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO) spinner.text = event.message;
  });

  setupAnalyzeMemory(
    scopeId,
    cwd,
    targetPath,
    llmConfig,
    escalateToLsp,
    options.force,
    options.lspTimeoutMs,
    options.lspProcesses,
    options.full,
  );

  try {
    const result = await docuviaApi.analyze(scopeId, logger);
    printAnalyzeResult(result, spinner, Boolean(options.fallbackAst));
  } catch (error: unknown) {
    handleAnalyzeError(error, targetPath, escalateToLsp, spinner);
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
