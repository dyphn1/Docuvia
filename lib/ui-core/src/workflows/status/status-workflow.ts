import { docuviaFactory, TOKENS, DocuviaError, ErrorCodes, type ILogger } from "@workspace/contracts";
import { STATUS_MESSAGES } from "./status-messages.js";
import { appendStatusLogLine } from "./status-log-writer.js";
import type { StatusResult } from "./status-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";

/**
 * The `status` workflow — opens `.docuvia/local.db` readonly and reports row counts for
 * `projects`/`l2_nodes`/`l3_nodes` (see `IGraphStore.pruneMissingFiles`'s neighbor additions,
 * `IProjectsRepo.count()`/`IGraphNodesRepo.count()`, for the schema-layer half of this).
 */
export class StatusWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger
  ) {}

  public async execute(): Promise<StatusResult> {
    const { workspaceRoot, logger } = this;

    logger.info(STATUS_MESSAGES.GETTING_STATUS);
    await appendStatusLogLine(workspaceRoot, { event: "status.start" });

    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);

    let store;
    try {
      store = await openStore({ dbPath: resolveDbPath(workspaceRoot), readonly: true });
    } catch (err) {
      // GraphStore.open() already throws DB_OPEN_FAILED on a missing file (reused as-is here) —
      // rewrap only to surface the "run docuvia init" guidance old Docuvia's status command gave.
      if (err instanceof DocuviaError && err.code === ErrorCodes.DB_OPEN_FAILED) {
        const notFound = new DocuviaError(ErrorCodes.DB_OPEN_FAILED, STATUS_MESSAGES.DB_NOT_FOUND, err);
        await appendStatusLogLine(workspaceRoot, {
          event: "status.error",
          message: STATUS_MESSAGES.DB_NOT_FOUND,
        });
        throw notFound;
      }
      throw err;
    }

    try {
      const { l2Nodes, l3Nodes } = store.graph.count();
      const result: StatusResult = { projects: store.projects.count(), l2Nodes, l3Nodes };
      await appendStatusLogLine(workspaceRoot, { event: "status.summary", ...result });
      return result;
    } finally {
      await store.close();
    }
  }
}
