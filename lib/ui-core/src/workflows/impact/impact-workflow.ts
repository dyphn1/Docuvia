import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  type ILogger,
} from "@workspace/contracts";
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
        err.code === ErrorCodes.DB_OPEN_FAILED
      ) {
        await appendImpactLogLine(workspaceRoot, {
          event: IMPACT_EVENTS.ERROR,
          target,
          message: IMPACT_MESSAGES.DB_NOT_FOUND,
        });
        throw new DocuviaError(
          ErrorCodes.DB_OPEN_FAILED,
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

      const riskLevel = impactService.computeRiskLevel(blastRadius.length);
      await appendImpactLogLine(workspaceRoot, {
        event: IMPACT_EVENTS.SUMMARY,
        target,
        found: true,
        blastRadiusCount: blastRadius.length,
        riskLevel,
      });

      return { blastRadius, riskLevel };
    } finally {
      await store.close();
    }
  }
}
