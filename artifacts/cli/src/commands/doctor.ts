import process from "process";
import crypto from "node:crypto";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import {
  docuviaMemory,
  DocuviaError,
  DiagnosticStatus,
  type DiagnosticResult,
  MemoryKeys,
} from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import * as path from "path";
import * as fs from "fs/promises";
import {
  DOCUVIA_HOOK_JS_FILENAME,
  CLAUDE_HOOKS_DIR,
  CURSOR_HOOKS_DIR,
  DOCUVIA_HOOK_CJS_FILENAME,
} from "../constants/init-templates.js";
import "../registration.js";

export interface DoctorOptions {
  skipDb?: boolean;
  skipGit?: boolean;
  skipHooks?: boolean;
  skipLogs?: boolean;
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

function printDiagnosticResult(key: string, res: DiagnosticResult): void {
  if (res.status === DiagnosticStatus.PASS) {
    ui.success(
      UI_MESSAGES.DOCTOR_DIAGNOSTIC_PREFIX +
        key +
        UI_MESSAGES.DOCTOR_DIAGNOSTIC_SUFFIX +
        res.message,
    );
    return;
  }
  ui.error(
    UI_MESSAGES.DOCTOR_DIAGNOSTIC_PREFIX +
      key +
      UI_MESSAGES.DOCTOR_DIAGNOSTIC_SUFFIX +
      res.message,
  );
  if (res.details) ui.warn(UI_MESSAGES.DOCTOR_DETAILS_PREFIX + res.details);
  if (res.suggestion)
    ui.info(UI_MESSAGES.DOCTOR_SUGGESTION_PREFIX + res.suggestion);
}

async function runDoctorDiagnostics(
  scopeId: string,
  logger: ReturnType<typeof createPinoBackedLogger>,
  workspaceRoot: string,
  options: Pick<DoctorOptions, "skipDb" | "skipGit" | "skipLogs" | "fix">,
): Promise<boolean> {
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, workspaceRoot);

  try {
    const result = await docuviaApi.doctor(scopeId, logger, {
      ...options,
      ...resolveDoctorLlmConfig(),
    });
    for (const [key, res] of Object.entries(result.diagnostics)) {
      printDiagnosticResult(key, res);
    }
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

function reportHookPresence(
  found: boolean,
  foundMessage: string,
  notFoundMessage: string,
): void {
  if (found) ui.success(`${UI_MESSAGES.DOCTOR_HOOKS_PREFIX}${foundMessage}`);
  else ui.warn(`${UI_MESSAGES.DOCTOR_HOOKS_PREFIX}${notFoundMessage}`);
}

async function reportDoctorHooksStatus(
  workspaceRoot: string,
  skipHooks: boolean,
): Promise<void> {
  if (skipHooks) {
    ui.info(UI_MESSAGES.DOCTOR_HOOKS_SKIPPED);
    return;
  }

  const claudeHooksPath = path.join(
    workspaceRoot,
    CLAUDE_HOOKS_DIR,
    DOCUVIA_HOOK_JS_FILENAME,
  );
  const cursorHooksPath = path.join(
    workspaceRoot,
    CURSOR_HOOKS_DIR,
    DOCUVIA_HOOK_CJS_FILENAME,
  );
  const hasClaude = await fs.stat(claudeHooksPath).catch(() => null);
  const hasCursor = await fs.stat(cursorHooksPath).catch(() => null);

  reportHookPresence(
    !!hasClaude,
    UI_MESSAGES.DOCTOR_CLAUDE_FOUND,
    UI_MESSAGES.DOCTOR_CLAUDE_NOT_FOUND,
  );
  reportHookPresence(
    !!hasCursor,
    UI_MESSAGES.DOCTOR_CURSOR_FOUND,
    UI_MESSAGES.DOCTOR_CURSOR_NOT_FOUND,
  );
}

export async function doctorCommand(
  workspaceRoot: string,
  options: DoctorOptions = {},
): Promise<void> {
  const {
    skipDb = false,
    skipGit = false,
    skipHooks = false,
    skipLogs = false,
    fix = false,
  } = options;
  try {
    ui.header(UI_MESSAGES.DOCTOR_HEADER);
    ui.info(UI_MESSAGES.DOCTOR_START);

    const scopeId = crypto.randomUUID();
    const logger = createPinoBackedLogger();

    const allPassed = await runDoctorDiagnostics(
      scopeId,
      logger,
      workspaceRoot,
      { skipDb, skipGit, skipLogs, fix },
    );

    await reportDoctorHooksStatus(workspaceRoot, skipHooks);

    if (allPassed) {
      ui.success(UI_MESSAGES.DOCTOR_ALL_PASSED);
    } else {
      ui.error(UI_MESSAGES.DOCTOR_SOME_FAILED);
      process.exitCode = 1;
    }
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    ui.error(UI_MESSAGES.DOCTOR_FAIL + errorMessage);
    process.exitCode = 1;
  }
}
