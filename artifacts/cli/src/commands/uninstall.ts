import crypto from "node:crypto";
import * as path from "path";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { OUTPUT_FORMAT_MARKERS } from "../constants/cli-output-markers.js";
import { selectPlatforms } from "../utils/platform-selection.js";
import { docuviaMemory, DocuviaError, MemoryKeys } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { createPinoBackedLogger } from "../logging/create-logger.js";
import { removeBlock } from "../utils/fs-utils.js";
import {
  AGENT_INSTRUCTIONS_MARKER,
  AGENT_INSTRUCTIONS_END_MARKER,
  CLAUDE_MD_FILENAME,
  CURSOR_RULES_FILENAME,
  WINDSURF_RULES_FILENAME,
  LLMS_TXT_FILENAME,
} from "../constants/init-templates.js";
import { uninstallSkills } from "../skills/install-skills.js";
import "../registration.js";

/** PLAT-008: the retired "Markdown Agents" catch-all used to write the same instructions block
 *  into these four files. None of the current named platforms own `.windsurfrules`/`llms.txt` at
 *  all, and `CLAUDE.md`/`.cursorrules` are only cleaned when their platform is explicitly
 *  selected — so this best-effort sweep always runs, letting repos set up under an older Docuvia
 *  version fully clean up via a plain `docuvia uninstall` regardless of `--platform=`. Each call
 *  is scoped to the `docuvia:start`/`docuvia:end` marker block only (never the rest of the file),
 *  and no-ops when the marker isn't present. */
async function cleanupLegacyMarkdownAgentBlocks(
  workspaceRoot: string,
): Promise<void> {
  const legacyTargets = [
    CLAUDE_MD_FILENAME,
    CURSOR_RULES_FILENAME,
    WINDSURF_RULES_FILENAME,
    LLMS_TXT_FILENAME,
  ];
  for (const filename of legacyTargets) {
    await removeBlock(
      path.join(workspaceRoot, filename),
      `<!-- ${AGENT_INSTRUCTIONS_MARKER} -->`,
      `<!-- ${AGENT_INSTRUCTIONS_END_MARKER} -->`,
    );
  }
}

type UninstallLogger = ReturnType<typeof createPinoBackedLogger>;

// Each platform is uninstalled independently: one platform's hook-removal failure must not
// silently skip the remaining platforms, nor the database cleanup below — previously it did
// (a single throw here propagated straight to the outer catch), leaving the workspace in an
// unknown partial state with no indication of what succeeded.
async function uninstallPlatformHooks(
  selectedPlatforms: Awaited<ReturnType<typeof selectPlatforms>>,
  workspaceRoot: string,
  logger: UninstallLogger,
): Promise<string[]> {
  const failures: string[] = [];
  for (const platform of selectedPlatforms) {
    try {
      await platform.uninstallHooks(workspaceRoot);
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
 *  backstop matching `cleanupUninstallDatabase`'s own shape). Also deletes the hidden
 *  `docuvia-knowledge` branch unless `keepDb` is set. */
async function removeGitHooksStep(
  workspaceRoot: string,
  keepDb: boolean,
  logger: UninstallLogger,
): Promise<string | null> {
  const scopeId = crypto.randomUUID();
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, workspaceRoot);
  docuviaMemory.set(scopeId, MemoryKeys.KEEP_DB, keepDb);

  try {
    const result = await docuviaApi.uninstallGitHooks(scopeId, logger);
    ui.success(
      UI_MESSAGES.UNINSTALL_GIT_HOOKS_SUCCESS(
        result.postCommitRemoved,
        result.prePushRemoved,
      ),
    );
    if (result.knowledgeBranchDeleted) {
      ui.success(UI_MESSAGES.UNINSTALL_KNOWLEDGE_BRANCH_DELETED);
    }
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

/** Removes the whole `.docuvia/` directory (unless `keepDb`) — `clean`'s DB-only wipe
 *  deliberately leaves the directory shell behind (logs, lockfiles, export artifacts); `uninstall`
 *  is the "leave the repo pristine" command, so it finishes the job. Never throws. */
async function removeDocuviaDirStep(
  workspaceRoot: string,
  keepDb: boolean,
  logger: UninstallLogger,
): Promise<string | null> {
  if (keepDb) {
    return null;
  }

  const scopeId = crypto.randomUUID();
  docuviaMemory.createScope(scopeId);
  docuviaMemory.set(scopeId, MemoryKeys.WORKSPACE_ROOT, workspaceRoot);

  try {
    const result = await docuviaApi.removeDocuviaDir(scopeId, logger);
    if (result.removed) ui.success(UI_MESSAGES.UNINSTALL_DOCUVIA_DIR_REMOVED);
    return null;
  } catch (error: unknown) {
    const message =
      error instanceof DocuviaError || error instanceof Error
        ? error.message
        : String(error);
    logger.warn(UI_MESSAGES.UNINSTALL_DOCUVIA_DIR_FAIL_LOG, {
      error: message,
    });
    ui.warn(UI_MESSAGES.UNINSTALL_DOCUVIA_DIR_FAIL + message);
    return UI_MESSAGES.UNINSTALL_DOCUVIA_DIR_FAILURE_NAME;
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

function handleSkillRemoval(workspaceRoot: string): void {
  try {
    const removed = uninstallSkills(workspaceRoot);
    if (removed.length > 0) {
      ui.success(`Removed ${removed.length} skill(s): ${removed.join(", ")}`);
    } else {
      ui.info("No Docuvia skill files found to remove.");
    }
  } catch (error) {
    ui.warn(
      `Skill removal failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function runCleanupSteps(
  selectedPlatforms: Awaited<ReturnType<typeof selectPlatforms>>,
  workspaceRoot: string,
  keepDb: boolean,
  logger: UninstallLogger,
): Promise<string[]> {
  const failures = await uninstallPlatformHooks(
    selectedPlatforms,
    workspaceRoot,
    logger,
  );

  await cleanupLegacyMarkdownAgentBlocks(workspaceRoot);

  const gitHooksFailure = await removeGitHooksStep(
    workspaceRoot,
    keepDb,
    logger,
  );
  if (gitHooksFailure) failures.push(gitHooksFailure);

  const dbFailure = await cleanupUninstallDatabase(
    workspaceRoot,
    keepDb,
    logger,
  );
  if (dbFailure) failures.push(dbFailure);

  // Runs last: wholesale-removes whatever is left under .docuvia/ (logs, lockfiles, export
  // artifacts) once the DB itself has already been dealt with above.
  const dirFailure = await removeDocuviaDirStep(workspaceRoot, keepDb, logger);
  if (dirFailure) failures.push(dirFailure);

  return failures;
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
  platformFilter?: string,
  keepDb: boolean = false,
  isInteractive: boolean = false,
  removeSkillFiles: boolean = false,
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
      isInteractive,
    );

    const failures = await runCleanupSteps(
      selectedPlatforms,
      workspaceRoot,
      keepDb,
      logger,
    );

    if (removeSkillFiles) {
      handleSkillRemoval(workspaceRoot);
    }

    reportUninstallOutcome(failures);
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logger.error(UI_MESSAGES.UNINSTALL_FAIL_LOG, { error: errorMessage });
    ui.warn(UI_MESSAGES.UNINSTALL_FAIL + errorMessage);
    process.exitCode = 1;
  }
}
