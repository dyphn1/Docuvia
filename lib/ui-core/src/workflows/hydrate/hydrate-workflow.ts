import { docuviaFactory, TOKENS, type ILogger } from "@workspace/contracts";
import { HYDRATE_MESSAGES } from "./hydrate-messages.js";
import { appendHydrateLogLine } from "./hydrate-log-writer.js";
import type { HydrateResult } from "./hydrate-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";

/**
 * The `hydrate` workflow — the explicit, user-triggerable counterpart to `snapshot` (STOR-002):
 * resolves the knowledge-branch commit matching the current source HEAD (or its nearest analyzed
 * ancestor) and bulk-loads its `graph/*.jsonl` into `local.db`, wholesale replacing its
 * `l2_nodes`/`node_links`. Opens the store read-write (unlike every other read-path workflow,
 * which opens readonly) since hydration is itself a write. `ensureHydrated()` (used by
 * query/impact/status/review) wraps this same `IHydrationService` for the automatic
 * staleness-check path; this workflow is the manual, always-runs path.
 */
export class HydrateWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger
  ) {}

  public async execute(): Promise<HydrateResult> {
    const { workspaceRoot, logger } = this;

    logger.info(HYDRATE_MESSAGES.HYDRATING);
    await appendHydrateLogLine(workspaceRoot, { event: "hydrate.start", workspaceRoot });

    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
    const store = await openStore({ dbPath: resolveDbPath(workspaceRoot), readonly: false });

    try {
      const hydrationService = docuviaFactory.resolve(TOKENS.HydrationService, { logger });
      const result = await hydrationService.hydrate(workspaceRoot, store);

      if (!result.hydrated) {
        await appendHydrateLogLine(workspaceRoot, {
          event: "hydrate.summary",
          hydrated: false,
          message: HYDRATE_MESSAGES.NOTHING_TO_HYDRATE,
        });
        return result;
      }

      await appendHydrateLogLine(workspaceRoot, {
        event: "hydrate.summary",
        hydrated: true,
        knowledgeSha: result.knowledgeSha,
        nodesLoaded: result.nodesLoaded,
        edgesLoaded: result.edgesLoaded,
        edgesDropped: result.edgesDropped,
      });
      return result;
    } finally {
      await store.close();
    }
  }
}
