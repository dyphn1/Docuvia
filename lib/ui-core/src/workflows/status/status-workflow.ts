import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type ILogger,
} from "@workspace/contracts";
import { STATUS_EVENTS, STATUS_MESSAGES } from "./status-messages.js";
import { appendStatusLogLine } from "./status-log-writer.js";
import type { StatusResult } from "./status-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { ensureHydrated } from "../../utils/ensure-hydrated.js";

/**
 * The `status` workflow — opens `.docuvia/local.db` readonly and reports row counts for
 * `projects`/`l2_nodes`/`l3_nodes` (see `IGraphStore.pruneMissingFiles`'s neighbor additions,
 * `IProjectsRepo.count()`/`IGraphNodesRepo.count()`, for the schema-layer half of this).
 */
export class StatusWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  public async execute(): Promise<StatusResult> {
    const { workspaceRoot, logger } = this;

    logger.info(STATUS_MESSAGES.GETTING_STATUS);
    await appendStatusLogLine(workspaceRoot, { event: STATUS_EVENTS.START });

    await ensureHydrated(workspaceRoot, logger);

    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);

    let store;
    try {
      store = await openStore({
        dbPath: resolveDbPath(workspaceRoot),
        readonly: true,
      });
    } catch (err) {
      // GraphStore.open() throws DB_NOT_FOUND for a genuinely-missing file — rethrow as-is, with
      // only the "run docuvia init" guidance swapped in (preserving the original cause). A
      // `DB_OPEN_FAILED` is a present-but-unopenable database and must NOT be masked as "not
      // found" — its message carries the real cause (native ABI mismatch, permissions, corruption).
      if (err instanceof DocuviaError && err.code === ErrorCodes.DB_NOT_FOUND) {
        const notFound = new DocuviaError(
          ErrorCodes.DB_NOT_FOUND,
          STATUS_MESSAGES.DB_NOT_FOUND,
          err,
        );
        await appendStatusLogLine(workspaceRoot, {
          event: STATUS_EVENTS.ERROR,
          message: STATUS_MESSAGES.DB_NOT_FOUND,
        });
        throw notFound;
      }
      throw err;
    }

    try {
      const { l2Nodes, l3Nodes } = store.graph.count();
      const { totalFiles, processedFiles } = store.files.getTierBCoverage();
      const result: StatusResult = {
        projects: store.projects.count(),
        l2Nodes,
        l3Nodes,
        tierBFilesProcessed: processedFiles,
        tierBFilesTotal: totalFiles,
      };
      await appendStatusLogLine(workspaceRoot, {
        event: STATUS_EVENTS.SUMMARY,
        ...result,
      });
      return result;
    } finally {
      await store.close();
    }
  }
}
