import fs from "fs/promises";
import path from "path";
import { DOCUVIA_DIR_NAME, type ILogger } from "@workspace/contracts";

const REMOVE_DOCUVIA_DIR_MESSAGES = {
  REMOVED: "Removed .docuvia/ directory",
  NOT_FOUND: ".docuvia/ directory not present; nothing to remove",
} as const;

/**
 * `uninstall`'s wholesale-removal of the `.docuvia/` directory itself (unless `--keep-db`) —
 * `docuvia clean` deliberately only deletes `local.db` and leaves the directory shell behind
 * (see `CleanWorkflow`'s doc comment), so `uninstall` — the "leave the repo pristine" command —
 * needs its own step to remove the rest (logs, lockfiles, `export-topology` artifacts, ...). A
 * plain filesystem operation, like `CleanWorkflow`: no `docuviaFactory` dependency needed.
 */
export async function removeDocuviaDataDir(
  workspaceRoot: string,
  logger: ILogger,
): Promise<{ removed: boolean }> {
  const dirPath = path.join(workspaceRoot, DOCUVIA_DIR_NAME);

  let exists = true;
  try {
    await fs.access(dirPath);
  } catch {
    exists = false;
  }

  if (!exists) {
    logger.debug(REMOVE_DOCUVIA_DIR_MESSAGES.NOT_FOUND);
    return { removed: false };
  }

  await fs.rm(dirPath, { recursive: true, force: true });
  logger.info(REMOVE_DOCUVIA_DIR_MESSAGES.REMOVED);
  return { removed: true };
}
