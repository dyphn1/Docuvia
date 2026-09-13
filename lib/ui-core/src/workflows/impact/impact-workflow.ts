import {
  BlastRadiusEdgeSources,
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  UTF8_ENCODING,
  type DynamicDependencyEvidence,
  type IGraphStore,
  type ILogger,
  type RiskLevel,
  type TierBCoverageHint,
} from "@workspace/contracts";
import { resolveTierBCoverageHint } from "@workspace/contracts";
import { IMPACT_EVENTS, IMPACT_MESSAGES } from "./impact-messages.js";
import { appendImpactLogLine } from "./impact-log-writer.js";
import {
  pickBackCompatCoverageNote,
  resolveImpactEpistemic,
  type TargetFileResolution,
} from "./resolve-impact-epistemic.js";
import { readCallResolution } from "../analyze/call-resolution-stats.js";
import type { ImpactResult } from "./impact-result.js";
import { resolveDbPath } from "../../utils/resolve-db-path.js";
import { ensureHydrated } from "../../utils/ensure-hydrated.js";
import * as path from "path";
import * as fs from "fs/promises";

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
      if (err instanceof DocuviaError && err.code === ErrorCodes.DB_NOT_FOUND) {
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

      const dynamicEvidence =
        impactService.getDynamicEvidence?.(store, target) ?? [];
      // Issue #393: candidate entries are intentionally visible in the blast-radius table but do
      // not count as confirmed dependents for risk scoring. If candidates are the only evidence,
      // the epistemic layer below returns UNKNOWN rather than manufacturing MEDIUM risk from a
      // dependency that may not occur at runtime.
      const confirmedBlastRadiusCount = blastRadius.filter(
        (entry) =>
          entry.edgeSource !== BlastRadiusEdgeSources.DYNAMIC_CANDIDATE,
      ).length;
      const riskLevel = impactService.computeRiskLevel(
        store,
        confirmedBlastRadiusCount,
      );
      await appendImpactLogLine(workspaceRoot, {
        event: IMPACT_EVENTS.SUMMARY,
        target,
        found: true,
        blastRadiusCount: blastRadius.length,
        riskLevel,
      });

      return {
        blastRadius,
        ...(dynamicEvidence.length > 0 ? { dynamicEvidence } : {}),
        ...(await this.resolveEpistemicFields(
          store,
          target,
          confirmedBlastRadiusCount,
          riskLevel,
          dynamicEvidence,
        )),
      };
    } finally {
      await store.close();
    }
  }

  /** Issue #192/#136/#393: resolves every confidence-adjacent field of the result -- the
   *  epistemic verdict, back-compat coverage note, Tier B coverage, and dynamic evidence. */
  private async resolveEpistemicFields(
    store: IGraphStore,
    target: string,
    confirmedBlastRadiusCount: number,
    computedRiskLevel: RiskLevel,
    dynamicEvidence: DynamicDependencyEvidence[],
  ): Promise<Omit<ImpactResult, "blastRadius" | "dynamicEvidence">> {
    const { tierBCoverage, registryMediated, targetFileResolution } =
      await this.resolveTargetContext(store, target, confirmedBlastRadiusCount);

    // Issue #192: raw workspace Tier B counts feed the epistemic verdict directly (unlike
    // `tierBCoverage`, which only fires on empty results) so a non-empty-but-partial graph is
    // flagged too -- a partially-populated graph must never read as a complete answer.
    const coverage = store.files.getTierBCoverage();

    const epistemicResult = resolveImpactEpistemic({
      blastRadiusCount: confirmedBlastRadiusCount,
      computedRiskLevel,
      workspaceFilesProcessed: coverage?.processedFiles,
      workspaceFilesTotal: coverage?.totalFiles,
      registryMediated,
      targetFileResolution,
      dynamicEvidence,
    });

    // Issue #192: partialCoverage flag -- true when Tier B coverage is incomplete. This remains
    // distinct from #393 dynamic evidence: one is ingestion completeness, the other is a modeled
    // runtime-analysis boundary.
    const hasPartialCoverage =
      coverage != null &&
      coverage.totalFiles > 0 &&
      coverage.processedFiles < coverage.totalFiles;

    const coverageNote = pickBackCompatCoverageNote(
      registryMediated,
      epistemicResult.riskNote,
    );

    return {
      riskLevel: epistemicResult.riskLevel,
      ...(epistemicResult.epistemic
        ? { epistemic: epistemicResult.epistemic }
        : {}),
      ...(epistemicResult.riskNote
        ? { riskNote: epistemicResult.riskNote }
        : {}),
      ...(coverageNote ? { coverageNote } : {}),
      ...(tierBCoverage ? { tierBCoverage } : {}),
      ...(hasPartialCoverage ? { partialCoverage: true } : {}),
    };
  }

  /** Resolves the target's node metadata: the Tier B hint (empty-result-only gating lives in
   *  `resolveTierBCoverageHint`), the issue #136 registry-mediated signal, and issue #221 P2''s
   *  own-file call-resolution counters. */
  private async resolveTargetContext(
    store: IGraphStore,
    target: string,
    confirmedBlastRadiusCount: number,
  ): Promise<{
    tierBCoverage?: TierBCoverageHint;
    registryMediated: boolean;
    targetFileResolution?: TargetFileResolution;
  }> {
    const node = store.graph.findNodeByName(target);
    const tierBCoverage = docuviaFactory
      .resolve(TOKENS.TierBCoverageHintProvider)
      .resolve(store, node?.filePath, confirmedBlastRadiusCount === 0, false);

    // Issue #136: a factory/registry-mediated dependency is invisible to the static edge graph.
    const registryMediated =
      confirmedBlastRadiusCount === 0 &&
      !!node?.filePath &&
      (await this.fileUsesFactoryRegistry(node.filePath));

    let targetFileResolution: TargetFileResolution | undefined;
    if (node?.filePath) {
      const stats = readCallResolution(store)[node.filePath];
      if (stats) {
        targetFileResolution = {
          resolved: stats.resolved,
          applicable: stats.total - stats.selfDiscarded,
        };
      }
    }

    return { tierBCoverage, registryMediated, targetFileResolution };
  }

  /** Issue #136: `true` when `filePath` contains the docuviaFactory registry pattern. */
  private async fileUsesFactoryRegistry(filePath: string): Promise<boolean> {
    let content: string;
    try {
      content = await fs.readFile(
        path.join(this.workspaceRoot, filePath),
        UTF8_ENCODING,
      );
    } catch {
      return false;
    }
    return /docuviaFactory|TOKENS\./.test(content);
  }
}
