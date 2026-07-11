import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";
import { WorkspaceGitService } from "./workspace-git.service.js";
import { IWorkspaceGitService } from "../interfaces/workspace-git.interfaces.js";
import { QueryService } from "./query-service.js";
import { LOCAL_DB_NOT_FOUND_MESSAGE } from "./status-service.js";
import { appendCommandLogLine } from "./command-log-writer.js";
import { REVIEW_LOG_FILE_NAME } from "../constants/paths.js";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ChangeDetectionResult {
  baseRef: string | null;
  filesChanged: Array<{ file: string; status: string }>;
  affectedNodes: Array<{ file: string; impactedBy: Array<{ name: string; type: string }> }>;
  riskLevel: RiskLevel;
  /** Human-readable summary — kept so `review.ts`'s `console.log(result.analysis)` still works. */
  analysis: string;
}

/**
 * Thresholds for the total impacted-node count across all changed files, modeled on
 * GitNexus's own LOW/MEDIUM/HIGH/CRITICAL scale. There's no existing "structural risk"
 * scorer in this codebase to reuse — `commit-scorer.ts`'s `scoreCommit()` is a different,
 * unrelated concern (commit-message/diff *noise* filtering for L3 generation, not
 * blast-radius risk) and is deliberately not reused here.
 */
export const IMPACT_RISK_THRESHOLDS = {
  HIGH_MIN: 6,
  CRITICAL_MIN: 21,
} as const;

/** A diff this large is inherently riskier to review even if individually low-impact. */
const LARGE_DIFF_FILE_FLOOR = 10;

/**
 * Shared LOW/MEDIUM/HIGH/CRITICAL derivation from a raw impacted-node count, using
 * `IMPACT_RISK_THRESHOLDS` above. Used both by `detectChanges()` (per-diff aggregate count)
 * and the standalone `docuvia impact <target>` command (single-symbol blast-radius count) so
 * the two never drift apart on what counts as "risky". Deliberately excludes `review`'s own
 * "large diff floor" LOW→MEDIUM bump (`LARGE_DIFF_FILE_FLOOR`) — that's driven by diff size,
 * not impacted-node count, and doesn't apply to a single-symbol `impact` query.
 */
export function computeImpactRiskLevel(impactedCount: number): RiskLevel {
  if (impactedCount >= IMPACT_RISK_THRESHOLDS.CRITICAL_MIN) {
    return "CRITICAL";
  }
  if (impactedCount >= IMPACT_RISK_THRESHOLDS.HIGH_MIN) {
    return "HIGH";
  }
  if (impactedCount >= 1) {
    return "MEDIUM";
  }
  return "LOW";
}

export class ChangeDetectionService {
  constructor(
    private workspaceRoot: string = process.cwd(),
    private workspaceGit: IWorkspaceGitService = new WorkspaceGitService(),
    // Left undefined by default (rather than `= new QueryService()`) so that when this
    // service is DI-resolved and later reconfigured with a different workspaceRoot
    // (`resolveConfiguredService`'s `Object.assign`), the lazily-constructed QueryService
    // below still points at the *current* workspaceRoot instead of the one captured at
    // DI-registration time. Tests can still inject a mock via this same param.
    private queryService: QueryService | undefined = undefined
  ) {}

  private resolveQueryService(): QueryService {
    return this.queryService ?? new QueryService(this.workspaceRoot);
  }

  public async detectChanges(baseRef?: string): Promise<ChangeDetectionResult> {
    logger.info({ baseRef }, "Detecting changes");
    await appendCommandLogLine(this.workspaceRoot, REVIEW_LOG_FILE_NAME, {
      event: "review.start",
      baseRef: baseRef ?? null,
    }).catch(() => {});

    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!fs.existsSync(dbPath)) {
      await appendCommandLogLine(this.workspaceRoot, REVIEW_LOG_FILE_NAME, {
        event: "review.error",
        message: LOCAL_DB_NOT_FOUND_MESSAGE,
      }).catch(() => {});
      throw new Error(LOCAL_DB_NOT_FOUND_MESSAGE);
    }

    const rawChanges = await this.workspaceGit.getChangedFilesSince(this.workspaceRoot, baseRef);
    const filesChanged = rawChanges.map((c) => ({ file: c.file, status: c.status }));

    const queryService = this.resolveQueryService();
    const affectedNodes: ChangeDetectionResult["affectedNodes"] = [];
    let totalImpacted = 0;

    for (const { file } of filesChanged) {
      const impact = await queryService.getImpact(file);
      if (impact && impact.blastRadius.length > 0) {
        affectedNodes.push({ file, impactedBy: impact.blastRadius });
        totalImpacted += impact.blastRadius.length;
      }
    }

    let riskLevel: RiskLevel = computeImpactRiskLevel(totalImpacted);

    // A huge diff is inherently riskier to review even if individually low-impact.
    if (riskLevel === "LOW" && filesChanged.length > LARGE_DIFF_FILE_FLOOR) {
      riskLevel = "MEDIUM";
    }

    const analysis = this.buildAnalysis(
      baseRef,
      filesChanged,
      affectedNodes,
      riskLevel,
      totalImpacted
    );

    await appendCommandLogLine(this.workspaceRoot, REVIEW_LOG_FILE_NAME, {
      event: "review.summary",
      baseRef: baseRef ?? null,
      riskLevel,
      filesChanged: filesChanged.length,
      affectedNodes: affectedNodes.length,
    }).catch(() => {});

    return {
      baseRef: baseRef ?? null,
      filesChanged,
      affectedNodes,
      riskLevel,
      analysis,
    };
  }

  private buildAnalysis(
    baseRef: string | undefined,
    filesChanged: ChangeDetectionResult["filesChanged"],
    affectedNodes: ChangeDetectionResult["affectedNodes"],
    riskLevel: RiskLevel,
    totalImpacted: number
  ): string {
    const lines: string[] = [];
    lines.push(`Base: ${baseRef ?? "working tree (HEAD)"}`);
    lines.push(`Files changed: ${filesChanged.length}`);
    lines.push(`Risk level: ${riskLevel}`);

    if (affectedNodes.length === 0) {
      lines.push("No local graph impact detected for the changed files.");
    } else {
      lines.push(
        `Impacted nodes: ${totalImpacted} across ${affectedNodes.length} changed file(s).`
      );
      lines.push("Top affected files:");
      const top = [...affectedNodes]
        .sort((a, b) => b.impactedBy.length - a.impactedBy.length)
        .slice(0, 5);
      for (const node of top) {
        const names = node.impactedBy
          .slice(0, 5)
          .map((n) => `${n.name} (${n.type})`)
          .join(", ");
        lines.push(`  - ${node.file}: ${node.impactedBy.length} dependent(s) [${names}]`);
      }
    }

    return lines.join("\n");
  }
}
