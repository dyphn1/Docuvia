import fs from "fs/promises";
import { DocuviaError, ErrorCodes, type ILogger } from "@workspace/contracts";
import { CLEAN_EVENTS, CLEAN_MESSAGES } from "./clean-messages.js";
import { appendCleanLogLine, writeCleanSummary } from "./clean-log-writer.js";
import type { CleanResult } from "./clean-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { isPathWithinWorkspace } from "../../utils/is-path-within-workspace.js";

/**
 * The `clean` workflow — wholesale-deletes `.docuvia/local.db` (see `IGraphStore.pruneMissingFiles`
 * for the surgical alternative, not currently wired to any command). No `docuviaFactory`
 * dependency needed: this is a plain filesystem operation, not a database one.
 */
export class CleanWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  public async execute(): Promise<CleanResult> {
    const { workspaceRoot, logger } = this;
    const dbPath = resolveDbPath(workspaceRoot);

    // Guardrail (issue #267): never unlink outside the workspace, even if path
    // construction ever changes — `resolveDbPath` joins trusted constants today,
    // but the delete itself must not trust its input blindly.
    if (!isPathWithinWorkspace(dbPath, workspaceRoot)) {
      throw new DocuviaError(
        ErrorCodes.CLEAN_WORKFLOW_FAILED,
        CLEAN_MESSAGES.PATH_ESCAPES_WORKSPACE(dbPath, workspaceRoot),
      );
    }

    logger.info(CLEAN_MESSAGES.CLEANING(dbPath));
    await appendCleanLogLine(workspaceRoot, { event: CLEAN_EVENTS.START });

    let exists = true;
    try {
      await fs.access(dbPath);
    } catch {
      exists = false;
    }

    if (!exists) {
      const result: CleanResult = {
        deleted: false,
        message: CLEAN_MESSAGES.NOT_FOUND,
      };
      await writeCleanSummary(workspaceRoot, result);
      return result;
    }

    try {
      await fs.unlink(dbPath);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.CLEAN_WORKFLOW_FAILED,
        CLEAN_MESSAGES.DELETE_FAILED(dbPath),
        err,
      );
    }

    logger.info(CLEAN_MESSAGES.DELETED_AT(dbPath));
    const result: CleanResult = {
      deleted: true,
      message: CLEAN_MESSAGES.DELETED,
    };
    await writeCleanSummary(workspaceRoot, result);
    return result;
  }
}
