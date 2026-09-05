import {
  docuviaFactory,
  TOKENS,
  DocuviaError,
  ErrorCodes,
  UTF8_ENCODING,
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

      return {
        blastRadius,
        ...(await this.resolveEpistemicFields(
          store,
          target,
          blastRadius.length,
          riskLevel,
        )),
      };
    } finally {
      await store.close();
    }
  }

  /** Issue #192/#136: resolves every confidence-adjacent field of the result -- the epistemic
   *  verdict (`riskLevel` override / `epistemic` / `riskNote`), the back-compat `coverageNote`,
   *  and `tierBCoverage`. Extracted out of `execute()` to keep its cyclomatic complexity under
   *  the ESLint budget (same refactor precedent as the old `resolveCoverageNote`). */
  private async resolveEpistemicFields(
    store: IGraphStore,
    target: string,
    blastRadiusLength: number,
    computedRiskLevel: RiskLevel,
  ): Promise<Omit<ImpactResult, "blastRadius">> {
    const { tierBCoverage, registryMediated, targetFileResolution } =
      await this.resolveTargetContext(store, target, blastRadiusLength);

    // Issue #192: raw workspace Tier B counts feed the epistemic verdict directly (unlike
    // `tierBCoverage`, which only fires on empty results) so a non-empty-but-partial graph is
    // flagged too -- a partially-populated graph must never read as a complete answer.
    const coverage = store.files.getTierBCoverage();

    const epistemicResult = resolveImpactEpistemic({
      blastRadiusCount: blastRadiusLength,
      computedRiskLevel,
      workspaceFilesProcessed: coverage?.processedFiles,
      workspaceFilesTotal: coverage?.totalFiles,
      registryMediated,
      targetFileResolution,
    });

    // Issue #192: partialCoverage flag -- true when Tier B coverage is incomplete
    // (processed < total) and we have a non-empty blast radius, or when empty blast radius
    // but Tier B is incomplete. This flag indicates the edge graph has known gaps.
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
   *  own-file call-resolution counters. Extracted from `resolveEpistemicFields` for the ESLint
   *  complexity budget. */
  private async resolveTargetContext(
    store: IGraphStore,
    target: string,
    blastRadiusLength: number,
  ): Promise<{
    tierBCoverage?: TierBCoverageHint;
    registryMediated: boolean;
    targetFileResolution?: TargetFileResolution;
  }> {
    // `impact` only ever reports the incoming/blast-radius direction -- `outgoingEmpty` is
    // hardcoded `false` so the "own file's outgoing calls" half of the hint never applies here
    // (see `resolveTierBCoverageHint`'s doc comment). Re-resolves the node by name (mirrors
    // `query.service.ts`'s own "re-resolve for metadata" precedent) since `IImpactService`
    // doesn't expose the resolved node's `filePath` today.
    const node = store.graph.findNodeByName(target);
    const tierBCoverage = docuviaFactory
      .resolve(TOKENS.TierBCoverageHintProvider)
      .resolve(store, node?.filePath, blastRadiusLength === 0, false);

    // Issue #136: a factory/registry-mediated dependency (docuviaFactory.register/resolve,
    // TOKENS.*) is invisible to the static edge graph -- an empty blast radius for such a
    // symbol is "partial coverage", never a confident LOW.
    const registryMediated =
      blastRadiusLength === 0 &&
      !!node?.filePath &&
      (await this.fileUsesFactoryRegistry(node.filePath));

    // Issue #221 P2': the target's own file's Tier A call-site resolution counters -- an empty
    // blast radius whose own file left most call sites unresolved is even less trustworthy
    // than the generic static-edges-only caveat. Absent stats degrade to `undefined`.
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

  /** Issue #136: `true` when `filePath` (workspace-relative) contains the docuviaFactory registry
   *  pattern (`docuviaFactory`, `TOKENS.`) -- a heuristic for "this symbol's dependents may be
   *  registry-mediated and thus invisible to the static edge graph". An unreadable file (deleted
   *  on disk, path mismatch) is `false`, never an error. */
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
