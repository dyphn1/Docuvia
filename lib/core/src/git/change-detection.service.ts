import type {
  ChangeDetectionResult,
  IChangeDetectionService,
  IImpactService,
  ILogger,
} from "@workspace/contracts";
import { createNoopLogger, RiskLevels } from "@workspace/contracts";
import { ImpactService } from "../impact/impact.service.js";
import { GitMessages } from "./git-constants.js";

/** A diff this large is inherently riskier to review even if individually low-impact (ported from old Docuvia's `LARGE_DIFF_FILE_FLOOR`). */
const LARGE_DIFF_FILE_FLOOR = 10;

/**
 * File-level change-detection aggregation (Domain Core logic) — mirrors old Docuvia's
 * `ChangeDetectionService.detectChanges`, minus the git-fetching/DB-opening concerns (those are
 * `lib/ui-core`'s job per docs/gitbook/architecture/application-lifecycle-and-state.md; this
 * service only aggregates an already-resolved changed-file list into a risk level + summary).
 */
export class ChangeDetectionService implements IChangeDetectionService {
  constructor(
    private readonly impactService: IImpactService = new ImpactService(),
    private readonly logger: ILogger = createNoopLogger(),
  ) {}

  detectChanges(
    input: Parameters<IChangeDetectionService["detectChanges"]>[0],
  ): ChangeDetectionResult {
    const { store, baseRef, filesChanged } = input;

    const affectedNodes: ChangeDetectionResult["affectedNodes"] = [];
    let totalImpacted = 0;

    for (const { file } of filesChanged) {
      const blastRadius = this.impactService.getBlastRadius(store, file);
      if (blastRadius && blastRadius.length > 0) {
        affectedNodes.push({ file, impactedBy: blastRadius });
        totalImpacted += blastRadius.length;
      }
    }

    let riskLevel = this.impactService.computeRiskLevel(store, totalImpacted);

    // A huge diff is inherently riskier to review even if individually low-impact.
    if (
      riskLevel === RiskLevels.LOW &&
      filesChanged.length > LARGE_DIFF_FILE_FLOOR
    ) {
      riskLevel = RiskLevels.MEDIUM;
    }

    const analysis = this.buildAnalysis(
      baseRef,
      filesChanged,
      affectedNodes,
      riskLevel,
      totalImpacted,
    );
    this.logger.debug(GitMessages.DETECTED_CHANGES, {
      baseRef,
      filesChanged: filesChanged.length,
      affectedNodes: affectedNodes.length,
      riskLevel,
    });

    return { baseRef, filesChanged, affectedNodes, riskLevel, analysis };
  }

  private buildAnalysis(
    baseRef: string | null,
    filesChanged: ChangeDetectionResult["filesChanged"],
    affectedNodes: ChangeDetectionResult["affectedNodes"],
    riskLevel: ChangeDetectionResult["riskLevel"],
    totalImpacted: number,
  ): string {
    const lines: string[] = [];
    lines.push(
      GitMessages.analysisBase(baseRef ?? GitMessages.WORKING_TREE_HEAD),
    );
    lines.push(GitMessages.analysisFilesChanged(filesChanged.length));
    lines.push(GitMessages.analysisRiskLevel(riskLevel));

    if (affectedNodes.length === 0) {
      lines.push(GitMessages.NO_LOCAL_GRAPH_IMPACT);
    } else {
      lines.push(
        GitMessages.analysisImpactedNodes(totalImpacted, affectedNodes.length),
      );
      lines.push(GitMessages.TOP_AFFECTED_FILES);
      const top = [...affectedNodes]
        .sort((a, b) => b.impactedBy.length - a.impactedBy.length)
        .slice(0, 5);
      for (const node of top) {
        const names = node.impactedBy
          .slice(0, 5)
          .map((n) => `${n.name} (${n.type})`)
          .join(", ");
        lines.push(
          GitMessages.analysisAffectedFileLine(
            node.file,
            node.impactedBy.length,
            names,
          ),
        );
      }
    }

    return lines.join("\n");
  }
}
