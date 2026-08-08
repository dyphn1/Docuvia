import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type ILogger,
} from "@workspace/contracts";
import { resolveTierBCoverageHint } from "@workspace/core";
import { IMPACT_EVENTS, IMPACT_MESSAGES } from "./impact-messages.js";
import { appendImpactLogLine } from "./impact-log-writer.js";
import type { ImpactResult } from "./impact-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { ensureHydrated } from "../../utils/ensure-hydrated.js";

/**
 * The `impact` workflow — 1-hop blast-radius lookup by target name (exact-then-LIKE), via the
 * Domain Core's `IImpactService` (mirrors old Docuvia's `QueryService.getImpact`, minus the
 * dead-code Postgres `ImpactAnalysisService`, which old Docuvia never wired to this command
 * either).
 */
export class ImpactWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  public async execute(target: string): Promise<ImpactResult | null> {
    const { workspaceRoot, logger } = this;

    logger.info(IMPACT_MESSAGES.RESOLVING);
    await appendImpactLogLine(workspaceRoot, {
      event: IMPACT_EVENTS.START,
      target,
    });

    await ensureHydrated(workspaceRoot, logger);

    const openStore = docuviaFactory.resolve(TOKENS.GraphStoreOpener);
    let store;
    try {
      store = await openStore({
        dbPath: resolveDbPath(workspaceRoot),
        readonly: true,
      });
    } catch (err) {
      if (
        err instanceof DocuviaError &&
        err.code === ErrorCodes.DB_NOT_FOUND
      ) {
        await appendImpactLogLine(workspaceRoot, {
          event: IMPACT_EVENTS.ERROR,
          target,
          message: IMPACT_MESSAGES.DB_NOT_FOUND,
        });
        throw new DocuviaError(
          ErrorCodes.DB_NOT_FOUND,
          IMPACT_MESSAGES.DB_NOT_FOUND,
          err,
        );
      }
      throw err;
    }

    try {
      const impactService = docuviaFactory.resolve(TOKENS.ImpactService, {
        logger,
      });
      const blastRadius = impactService.getBlastRadius(store, target);

      if (!blastRadius) {
        await appendImpactLogLine(workspaceRoot, {
          event: IMPACT_EVENTS.SUMMARY,
          target,
          found: false,
          blastRadiusCount: 0,
          riskLevel: null,
        });
        return null;
      }

      const riskLevel = impactService.computeRiskLevel(
        store,
        blastRadius.length,
      );
      await appendImpactLogLine(workspaceRoot, {
        event: IMPACT_EVENTS.SUMMARY,
        target,
        found: true,
        blastRadiusCount: blastRadius.length,
        riskLevel,
      });

      // `impact` only ever reports the incoming/blast-radius direction -- `outgoingEmpty` is
      // hardcoded `false` so the "own file's outgoing calls" half of the hint never applies here
      // (see `resolveTierBCoverageHint`'s doc comment). Re-resolves the node by name (mirrors
      // `query.service.ts`'s own "re-resolve for metadata" precedent) since `IImpactService`
      // doesn't expose the resolved node's `filePath` today.
      const node = store.graph.findNodeByName(target);
      const tierBCoverage = resolveTierBCoverageHint(
        store,
        node?.filePath,
        blastRadius.length === 0,
        false,
      );

      return {
        blastRadius,
        riskLevel,
        ...(tierBCoverage ? { tierBCoverage } : {}),
      };
    } finally {
      await store.close();
    }
  }
}
