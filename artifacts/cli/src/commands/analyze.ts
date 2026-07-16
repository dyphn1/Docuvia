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
} as const;

type AnalyzeResult = Awaited<ReturnType<typeof docuviaApi.analyze>>;
type AnalyzeSpinner = ReturnType<typeof ui.spinner>;

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
      UI_MESSAGES.ANALYZE_DECISION_PREFIX +
        decision.nodeType +
        UI_MESSAGES.ANALYZE_DECISION_MID +
        decision.title +
        UI_MESSAGES.ANALYZE_DECISION_CONFIDENCE_PREFIX +
        decision.confidence +
        UI_MESSAGES.ANALYZE_DECISION_CONFIDENCE_SUFFIX,
    );
    if (decision.content) {
      ui.log(UI_MESSAGES.ANALYZE_DECISION_CONTENT_PREFIX + decision.content);
    }
  }
  ui.info(
    UI_MESSAGES.ANALYZE_FOCUSED_PERSISTED(result.persisted, result.deduped),
  );
}

function printAnalyzeResult(
  result: AnalyzeResult,
  spinner: AnalyzeSpinner,
): void {
  switch (result.kind) {
    case ANALYZE_RESULT_KIND.AUTO_FULL_INGESTION:
      printAutoFullIngestionResult(result, spinner);
      break;
    case ANALYZE_RESULT_KIND.AUTO_DELTA:
      printAutoDeltaResult(result, spinner);
      break;
    case ANALYZE_RESULT_KIND.AUTO_DELTA_NOOP:
      spinner.succeed(UI_MESSAGES.ANALYZE_AUTO_NOOP_SUCCESS);
      break;
    case ANALYZE_RESULT_KIND.DECISION_EXTRACTION:
      printFocusedResult(result, spinner);
      break;
  }
}

function startAnalyzeSpinner(targetPath: string | undefined): AnalyzeSpinner {
  ui.header(
    targetPath
      ? UI_MESSAGES.ANALYZE_FOCUSED_HEADER
      : UI_MESSAGES.ANALYZE_HEADER,
  );
  return ui
    .spinner(
      targetPath
        ? UI_MESSAGES.ANALYZE_FOCUSED_START + targetPath + "..."
        : UI_MESSAGES.ANALYZE_START,
    )
    .start();
}

function setupAnalyzeMemory(
  scopeId: string,
  cwd: string,
  targetPath: string | undefined,
  llmConfig: AnalyzeLlmConfig | undefined,
): void {
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);
  if (targetPath && llmConfig) {
    docuviaMemory.set(scopeId, MemoryKeys.TARGET_PATH, targetPath);
    docuviaMemory.set(scopeId, MemoryKeys.LLM_BASE_URL, llmConfig.llmBaseUrl);
    docuviaMemory.set(scopeId, MemoryKeys.LLM_API_KEY, llmConfig.llmApiKey);
    docuviaMemory.set(scopeId, MemoryKeys.LLM_MODEL, llmConfig.llmModel);
  }
}

function handleAnalyzeError(
  error: unknown,
  targetPath: string | undefined,
  spinner: AnalyzeSpinner,
): void {
  const message =
    error instanceof DocuviaError || error instanceof Error
      ? error.message
      : String(error);
  spinner.fail(
    (targetPath ? UI_MESSAGES.ANALYZE_FOCUSED_FAIL : UI_MESSAGES.ANALYZE_FAIL) +
      message,
  );
  // process.exitCode (not process.exit()) for both branches — the targetPath branch follows
  // a real network call (LLM chat completion); forcing an immediate exit while fetch/undici
  // handles are still closing crashes natively on Windows. See sync.ts's identical fix.
  process.exitCode = 1;
}

/**
 * Thin caller of `docuviaApi.analyze()` — both branches:
 * - No `targetPath`: auto mode (PLAT-007 Tier A; phase1-decision-integration.md §6) — a sha
 *   fast-path no-op, full ingestion (empty graph), or delta ingestion (non-empty graph, `HEAD`
 *   moved), each reported with its own `result.kind`-specific summary below.
 * - `targetPath` given: focused LLM decision extraction (mirrors old Docuvia's
 *   `runFocusedExtraction`/the old `extract` command). Requires
 *   `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` and a model
 *   (`AI_DOCUVIA_MODEL`/`AI_DOCUVIA_FAST_MODEL`) to be set; missing env vars are a hard failure
 *   (exit 1) rather than a silent skip — unlike `sync.ts`'s missing-env behavior — because a
 *   user who explicitly asked to analyze a path expects LLM extraction to actually run.
 */
export async function analyzeCommand(
  targetPath?: string,
  cwd: string = process.cwd(),
) {
  let llmConfig: AnalyzeLlmConfig | undefined;

  if (targetPath) {
    const resolved = resolveAnalyzeLlmConfig();
    if (!resolved) {
      ui.error(UI_MESSAGES.ANALYZE_LLM_MISSING_ENV);
      process.exitCode = 1;
      return;
    }
    llmConfig = resolved;
  }

  const spinner = startAnalyzeSpinner(targetPath);
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO) spinner.text = event.message;
  });

  setupAnalyzeMemory(scopeId, cwd, targetPath, llmConfig);

  try {
    const result = await docuviaApi.analyze(scopeId, logger);
    printAnalyzeResult(result, spinner);
  } catch (error: unknown) {
    handleAnalyzeError(error, targetPath, spinner);
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}
