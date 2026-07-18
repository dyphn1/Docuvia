import crypto from "node:crypto";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { OUTPUT_FORMAT_MARKERS } from "../constants/cli-output-markers.js";
import { selectPlatforms } from "../utils/platform-selection.js";
import { docuviaMemory, DocuviaError, MemoryKeys } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import "../registration.js";

type UninstallLogger = ReturnType<typeof createPinoBackedLogger>;

// Each platform is uninstalled independently: one platform's hook-removal failure must not
// silently skip the remaining platforms, nor the database cleanup below — previously it did
// (a single throw here propagated straight to the outer catch), leaving the workspace in an
// unknown partial state with no indication of what succeeded.
async function uninstallPlatformHooks(
  selectedPlatforms: Awaited<ReturnType<typeof selectPlatforms>>,
  workspaceRoot: string,
  allowGlobalMcpConfig: boolean,
  logger: UninstallLogger,
): Promise<string[]> {
  const failures: string[] = [];
  for (const platform of selectedPlatforms) {
    try {
      await platform.uninstallHooks(workspaceRoot, allowGlobalMcpConfig);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `${UI_MESSAGES.UNINSTALL_HOOKS_FAIL_LOG}${OUTPUT_FORMAT_MARKERS.DOUBLE_QUOTE}${platform.name}${OUTPUT_FORMAT_MARKERS.DOUBLE_QUOTE}`,
        {
          platform: platform.name,
          error: message,
        },
      );
      ui.warn(
        UI_MESSAGES.UNINSTALL_PLATFORM_FAIL +
          platform.name +
          UI_MESSAGES.UNINSTALL_PLATFORM_FAIL_MID +
          message,
      );
      failures.push(platform.name);
    }
  }
  return failures;
}

/** Returns the git-hooks-removal failure name, or `null` when it succeeded (never throws itself —
 *  `docuviaApi.uninstallGitHooks()` is already non-fatal per hook, this catch is a defensive
 *  backstop matching `cleanupUninstallDatabase`'s own shape). */
async function removeGitHooksStep(
  workspaceRoot: string,
  logger: UninstallLogger,
): Promise<string | null> {
  const scopeId = crypto.randomUUID();
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, workspaceRoot);

  try {
    const result = await docuviaApi.uninstallGitHooks(scopeId, logger);
    ui.success(
      UI_MESSAGES.UNINSTALL_GIT_HOOKS_SUCCESS(
        result.postCommitRemoved,
        result.prePushRemoved,
      ),
    );
    return null;
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    logger.warn(UI_MESSAGES.UNINSTALL_GIT_HOOKS_FAIL_LOG, { error: message });
    ui.warn(UI_MESSAGES.UNINSTALL_GIT_HOOKS_FAIL + message);
    return UI_MESSAGES.UNINSTALL_GIT_HOOKS_FAILURE_NAME;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}

/** Returns the DB-cleanup failure name, or `null` when skipped/succeeded. */
async function cleanupUninstallDatabase(
  workspaceRoot: string,
  keepDb: boolean,
  logger: UninstallLogger,
): Promise<string | null> {
  if (keepDb) {
    ui.info(UI_MESSAGES.UNINSTALL_KEEP_DB);
    return null;
  }

  const scopeId = crypto.randomUUID();
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, workspaceRoot);

  try {
    const result = await docuviaApi.clean(scopeId, logger);
    ui.success(UI_MESSAGES.UNINSTALL_SUCCESS_CLEAN + result.message);
    return null;
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    logger.warn(UI_MESSAGES.UNINSTALL_DB_CLEANUP_FAIL_LOG, {
      error: message,
    });
    ui.warn(UI_MESSAGES.UNINSTALL_FAIL_CLEAN + message);
    return UI_MESSAGES.UNINSTALL_DB_CLEANUP_FAILURE_NAME;
  } finally {
    docuviaMemory.deleteScope(scopeId);
  }
}

function reportUninstallOutcome(failures: string[]): void {
  if (failures.length > 0) {
    ui.warn(UI_MESSAGES.UNINSTALL_PARTIAL + failures.join(", "));
    process.exitCode = 1;
  } else {
    ui.success(UI_MESSAGES.UNINSTALL_SUCCESS);
  }
}

export async function uninstallCommand(
  workspaceRoot: string,
  allowGlobalMcpConfig: boolean,
  platformFilter?: string,
  keepDb: boolean = false,
): Promise<void> {
  if (!workspaceRoot) {
    ui.error(UI_MESSAGES.UNINSTALL_INVALID_WORKSPACE_ROOT);
    process.exitCode = 1;
    return;
  }

  const logger = createPinoBackedLogger();

  try {
    ui.header(UI_MESSAGES.UNINSTALL_HEADER);
    ui.info(UI_MESSAGES.UNINSTALL_START);

    const selectedPlatforms = await selectPlatforms(
      UI_MESSAGES.UNINSTALL_HOOKS_SELECT,
      platformFilter,
    );

    const failures = await uninstallPlatformHooks(
      selectedPlatforms,
      workspaceRoot,
      allowGlobalMcpConfig,
      logger,
    );

    const gitHooksFailure = await removeGitHooksStep(workspaceRoot, logger);
    if (gitHooksFailure) failures.push(gitHooksFailure);

    const dbFailure = await cleanupUninstallDatabase(
      workspaceRoot,
      keepDb,
      logger,
    );
    if (dbFailure) failures.push(dbFailure);

    reportUninstallOutcome(failures);
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logger.error(UI_MESSAGES.UNINSTALL_FAIL_LOG, { error: errorMessage });
    ui.warn(UI_MESSAGES.UNINSTALL_FAIL + errorMessage);
    process.exitCode = 1;
  }
}
