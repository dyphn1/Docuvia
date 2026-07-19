import process from "process";
import crypto from "node:crypto";
import { z } from "zod";
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
import { CLI_ERROR_MESSAGES } from "../constants/cli-errors.js";
import { selectPlatforms } from "../utils/platform-selection.js";
import { withInitCommandLock } from "../utils/init-command-lock.js";

/** Boundary validation (design-spirit.md #4) — the first thing that touches CLI-supplied input. */
const InitInputSchema = z.object({
  cwd: z.string().min(1, CLI_ERROR_MESSAGES.WORKSPACE_ROOT_EMPTY),
  platformFilter: z.string().optional(),
});

/**
 * Thin caller of `docuviaApi.init()` — the Presentation layer's job is limited to: generate a
 * request-scoped memory UUID, inject config into `docuviaMemory`, own the logger sink, call the
 * Orchestration layer, and garbage-collect the memory scope when done (see
 * docs/gitbook/architecture/application-lifecycle-and-state.md's "Bootstrapper & Garbage
 * Collector" role).
 */
async function runDatabaseInit(cwd: string): Promise<void> {
  const spinner = ui.spinner(UI_MESSAGES.INIT_START).start();
  const scopeId = crypto.randomUUID();
  const logger = createPinoBackedLogger();
  // Surface workflow progress on the spinner too, in addition to the pino sink.
  logger.onLog((event) => {
    if (event.level === LogLevels.INFO) spinner.text = event.message;
  });

  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, cwd);

  try {
    const result = await docuviaApi.init(scopeId, logger);
    if (result.partialFailure) {
      spinner.warn(result.message);
    } else {
      spinner.succeed(result.message);
    }
  } catch (error: unknown) {
    const errorMessage =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    spinner.fail(UI_MESSAGES.INIT_FAILED + errorMessage);
    throw error;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}

async function configureAgentIntegrations(
  cwd: string,
  platformFilter: string | undefined,
): Promise<void> {
  ui.info(UI_MESSAGES.INIT_AGENT_HOOKS);

  const selectedPlatforms = await selectPlatforms(
    UI_MESSAGES.INIT_HOOKS_SELECT,
    platformFilter,
  );

  if (selectedPlatforms.length === 0) {
    ui.info(UI_MESSAGES.INIT_HOOKS_NONE_SELECTED);
    return;
  }

  for (const platform of selectedPlatforms) {
    await platform.installHooks(cwd);
  }

  ui.success(UI_MESSAGES.INIT_HOOKS_SUCCESS);
  ui.info(UI_MESSAGES.INIT_HOOKS_SUPPORTED);
}

export async function initCommand(
  cwd: string = process.cwd(),
  platformFilter?: string,
) {
  const input = InitInputSchema.parse({
    cwd,
    platformFilter,
  });

  ui.header(UI_MESSAGES.INIT_HEADER);

  // Optional interactive confirmation if TTY
  if (process.stdin.isTTY) {
    const proceed = await ui.askConfirm(UI_MESSAGES.INIT_CONFIRM, true);
    if (!proceed) {
      ui.warn(UI_MESSAGES.INIT_ABORTED);
      process.exit(0);
    }
  }

  let databaseInitFailed = false;
  let hooksError: unknown;
  await withInitCommandLock(
    input.cwd,
    async () => {
      try {
        await runDatabaseInit(input.cwd);
      } catch {
        // runDatabaseInit already reported the failure (spinner.fail) and deleted its memory
        // scope in its own finally before this catch sees the rethrown error.
        databaseInitFailed = true;
      }

      if (!databaseInitFailed) {
        try {
          await configureAgentIntegrations(input.cwd, input.platformFilter);
        } catch (error) {
          hooksError = error;
        }
      }
    },
    () => ui.info(UI_MESSAGES.INIT_LOCK_WAITING),
  );

  if (databaseInitFailed) process.exit(1);
  if (hooksError !== undefined) {
    ui.error(UI_MESSAGES.INIT_HOOKS_FAIL + hooksError);
    process.exit(1);
  }
}
