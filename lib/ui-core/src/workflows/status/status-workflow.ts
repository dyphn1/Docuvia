import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type IGraphStore,
  type ILogger,
} from "@workspace/contracts";
import { STATUS_EVENTS, STATUS_MESSAGES } from "./status-messages.js";
import { appendStatusLogLine } from "./status-log-writer.js";
import type { StatusResult, GraphFreshness } from "./status-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { ensureHydrated } from "../../utils/ensure-hydrated.js";
import { GitConstants } from "@workspace/contracts";
import { readTierCQueue } from "../analyze/tier-c-queue.js";

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
        // Issue #58: a permanently-empty Tier C queue is the exact "Tier C never backfills"
        // symptom -- surface its size alongside the other graph metrics.
        tierCQueued: readTierCQueue(store).length,
        graphFreshness: await this.resolveGraphFreshness(store),
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

  /**
   * Issue #193: cheap HEAD-vs-last-ingested comparison for `status` (doctor's
   * `post_commit_ingestion` is the thorough diagnostic; this is the quick check
   * for agents/hooks). Fail-open to `"unknown"` on any missing input or error --
   * freshness must never crash `status`.
   */
  private async resolveGraphFreshness(
    store: IGraphStore,
  ): Promise<GraphFreshness> {
    try {
      if (!docuviaFactory.has(TOKENS.GitProvider)) return "unknown";
      const git = docuviaFactory.resolve(TOKENS.GitProvider);
      const headSha = await git.getHeadSha(this.workspaceRoot);
      if (!headSha) return "unknown";
      const lastIngested = store.meta.get(
        GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA,
      );
      if (!lastIngested) return "unknown";
      return lastIngested === headSha ? "fresh" : "stale";
    } catch {
      return "unknown";
    }
  }
}
