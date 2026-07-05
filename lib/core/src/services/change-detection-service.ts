import { execFile } from "child_process";
import { promisify } from "util";
import { RiskScore, RiskScoreType, FileRiskExtensions } from "../constants/risk-scores.js";

const execFileAsync = promisify(execFile);

export class ChangeDetectionService {
  constructor(private workspaceRoot: string) {}

  public async detectChanges(baseRef?: string) {
    let riskScore: RiskScoreType = RiskScore.LOW;
    let analysis = "";

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff", "--name-status", "-M", baseRef || "HEAD"],
        {
          cwd: this.workspaceRoot,
        }
      );
      const filesChanged = stdout.split("\n").filter((line) => line.trim().length > 0);

      let hasHighRisk = false;
      let hasMediumRisk = false;

      for (const fileLine of filesChanged) {
        const parts = fileLine.split("\t");
        let filePath = parts[parts.length - 1]; // Handling cases like rename where there are 3 parts
        const status = parts[0];

        if (status.startsWith("R") && parts.length >= 3) {
          filePath = parts[2]; // The new path is the 3rd element
        }

        if (!filePath) continue;

        if (FileRiskExtensions.HIGH.some((ext) => filePath.endsWith(ext))) {
          hasHighRisk = true;
        } else if (FileRiskExtensions.MEDIUM.some((ext) => filePath.endsWith(ext))) {
          hasMediumRisk = true;
        }
      }

      if (hasHighRisk) {
        riskScore = RiskScore.HIGH;
      } else if (hasMediumRisk) {
        riskScore = RiskScore.MEDIUM;
      }

      analysis = `Risk Score: ${riskScore}\nDetected ${filesChanged.length} changed files.`;
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      analysis = `Risk Score: ${riskScore}\nFailed to detect changes: ${errorMessage}`;
    }

    return {
      riskScore,
      analysis,
    };
  }
}
