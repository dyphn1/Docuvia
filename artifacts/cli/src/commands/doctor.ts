import process from "process";
import crypto from "node:crypto";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { BOX_CHARS } from "../constants/box-drawing.js";
import {
  docuviaMemory,
  DocuviaError,
  type DiagnosticResult,
  MemoryKeys,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import "../registration.js";
import {
  DOCTOR_CATEGORY_ORDER,
  DOCTOR_TABLE_COLUMNS,
  buildDiagnosticRow,
  groupDiagnosticsByCategory,
  summarizeDiagnostics,
} from "./doctor-report.js";

/** Width of the plain horizontal rule that separates the per-category tables from the final
 *  pass/fail summary line -- a visual break, not a table border, so it isn't sized by content. */
const SUMMARY_RULE_WIDTH = 60;

export interface DoctorOptions {
  skipDb?: boolean;
  skipGit?: boolean;
  skipHooks?: boolean;
  skipLogs?: boolean;
  skipLsp?: boolean;
  skipLlm?: boolean;
  /** `--fix` (phase1-decision-integration.md §10d, T6) -- forwarded verbatim to
   *  `docuviaApi.doctor()`; see `DoctorWorkflow`'s own doc comment for what it does. */
  fix?: boolean;
}

/** Reads the Tier C LLM env vars (§10e bullet 3, T7) -- mirrors `analyze.ts`'s
 *  `resolveAnalyzeLlmConfig`, Presentation-layer-only env read. Unlike `analyze <targetPath>`'s
 *  hard requirement, absence here is a normal, non-error `doctor` state -- both fields are simply
 *  `undefined`. */
function resolveDoctorLlmConfig(): {
  llmBaseUrl: string | undefined;
  llmApiKey: string | undefined;
} {
  return {
    llmBaseUrl: process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL,
    llmApiKey: process.env.AI_DOCUVIA_INTEGRATIONS_OPENAI_API_KEY,
  };
}

/** Renders one `ui.section()` + `ui.table()` per non-empty diagnostic category, in
 *  `DOCTOR_CATEGORY_ORDER`. */
function printDiagnosticsReport(
  diagnostics: Record<string, DiagnosticResult>,
): void {
  const groups = groupDiagnosticsByCategory(diagnostics);
  for (const category of DOCTOR_CATEGORY_ORDER) {
    const entries = groups.get(category);
    if (!entries || entries.length === 0) continue;
    ui.section(category);
    ui.table(
      DOCTOR_TABLE_COLUMNS,
      entries.map(([key, result]) => buildDiagnosticRow(key, result)),
    );
  }
}

/** Final pass/fail rollup printed after every category table -- per-row suggestions already live
 *  in the "Suggested Fix" column, so this stays a one-line verdict plus the `--fix` hint. */
function printDoctorSummary(
  diagnostics: Record<string, DiagnosticResult>,
  allPassed: boolean,
): void {
  const { passed, total } = summarizeDiagnostics(diagnostics);
  ui.log("");
  ui.log(BOX_CHARS.HORIZONTAL.repeat(SUMMARY_RULE_WIDTH));
  const summaryLine = UI_MESSAGES.DOCTOR_SUMMARY_PASSED(passed, total);
  if (allPassed) {
    ui.success(summaryLine);
    return;
  }
  ui.error(summaryLine);
  ui.info(UI_MESSAGES.DOCTOR_FIX_HINT);
}

async function runDoctorDiagnostics(
  scopeId: string,
  logger: ReturnType<typeof createPinoBackedLogger>,
  workspaceRoot: string,
  options: DoctorOptions,
): Promise<boolean> {
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, workspaceRoot);

  try {
    const result = await docuviaApi.doctor(scopeId, logger, {
      ...options,
      ...resolveDoctorLlmConfig(),
    });
    printDiagnosticsReport(result.diagnostics);
    printDoctorSummary(result.diagnostics, result.allPassed);
    return result.allPassed;
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    ui.error(UI_MESSAGES.DOCTOR_FAIL + message);
    return false;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}

/** Applies every `DoctorOptions` skip flag's default -- pulled out of `doctorCommand` solely to
 *  keep its own cyclomatic complexity under the project's ESLint budget as skip flags accumulate. */
function resolveDoctorOptions(
  options: DoctorOptions,
): Required<
  Pick<
    DoctorOptions,
    | "skipDb"
    | "skipGit"
    | "skipHooks"
    | "skipLogs"
    | "skipLsp"
    | "skipLlm"
    | "fix"
  >
> {
  const {
    skipDb = false,
    skipGit = false,
    skipHooks = false,
    skipLogs = false,
    skipLsp = false,
    skipLlm = false,
    fix = false,
  } = options;
  return { skipDb, skipGit, skipHooks, skipLogs, skipLsp, skipLlm, fix };
}

export async function doctorCommand(
  workspaceRoot: string,
  options: DoctorOptions = {},
): Promise<void> {
  try {
    ui.header(UI_MESSAGES.DOCTOR_HEADER);
    ui.info(UI_MESSAGES.DOCTOR_START);

    const scopeId = crypto.randomUUID();
    const logger = createPinoBackedLogger();

    const allPassed = await runDoctorDiagnostics(
      scopeId,
      logger,
      workspaceRoot,
      resolveDoctorOptions(options),
    );

    if (!allPassed) process.exitCode = 1;
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    ui.error(UI_MESSAGES.DOCTOR_FAIL + errorMessage);
    process.exitCode = 1;
  }
}
