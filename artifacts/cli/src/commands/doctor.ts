import process from "process";
import crypto from "node:crypto";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import {
  docuviaMemory,
  DocuviaError,
  DiagnosticStatus,
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
  } = options;
  try {
    ui.header(UI_MESSAGES.DOCTOR_HEADER);
    ui.info(UI_MESSAGES.DOCTOR_START);

    const scopeId = crypto.randomUUID();
    const logger = createPinoBackedLogger();

    docuviaMemory.createScope(scopeId);
    docuviaMemory.set(scopeId, "workspaceRoot", workspaceRoot);

    let allPassed = true;

    try {
      const result = await docuviaApi.doctor(scopeId, logger, {
        skipDb,
        skipGit,
        skipLogs,
      });
      allPassed = result.allPassed;

      for (const [key, res] of Object.entries(result.diagnostics)) {
        if (res.status === DiagnosticStatus.PASS) {
          ui.success(`[${key}] ${res.message}`);
        } else {
          ui.error(`[${key}] ${res.message}`);
          if (res.details) ui.warn(`    ${res.details}`);
          if (res.suggestion) ui.info(`    💡 Fix: ${res.suggestion}`);
        }
      }
    } catch (error: unknown) {
      const message =
        error instanceof DocuviaError || error instanceof Error
          ? error.message
          : String(error);
      ui.error(UI_MESSAGES.DOCTOR_FAIL + message);
      allPassed = false;
    } finally {
      docuviaMemory.deleteScope(scopeId);
    }

    if (skipHooks) {
      ui.info("[Hooks] Skipped (--skip-hooks)");
    } else {
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

      if (hasClaude) ui.success(`[Hooks] ${UI_MESSAGES.DOCTOR_CLAUDE_FOUND}`);
      else ui.warn(`[Hooks] ${UI_MESSAGES.DOCTOR_CLAUDE_NOT_FOUND}`);

      if (hasCursor) ui.success(`[Hooks] ${UI_MESSAGES.DOCTOR_CURSOR_FOUND}`);
      else ui.warn(`[Hooks] ${UI_MESSAGES.DOCTOR_CURSOR_NOT_FOUND}`);
    }

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
