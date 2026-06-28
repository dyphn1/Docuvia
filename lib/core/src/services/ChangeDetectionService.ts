import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export class ChangeDetectionService {
  constructor(private workspaceRoot: string) {}

  public async detectChanges(baseRef?: string) {
    let riskScore = "Low";
    let analysis = "";

    try {
      const { stdout } = await execFileAsync("git", ["diff", "--name-status", baseRef || "HEAD"], { cwd: this.workspaceRoot });
      const filesChanged = stdout.split("\n").filter((line) => line.trim().length > 0);
      
      let hasHighRisk = false;
      let hasMediumRisk = false;
      
      for (const fileLine of filesChanged) {
        const parts = fileLine.split("\t");
        const filePath = parts[parts.length - 1]; // Handling cases like rename where there are 3 parts
        
        if (!filePath) continue;

        if (filePath.endsWith(".ts") || filePath.endsWith(".js") || filePath.endsWith(".json")) {
          hasHighRisk = true;
        } else if (filePath.endsWith(".css") || filePath.endsWith(".html")) {
          hasMediumRisk = true;
        }
      }

      if (hasHighRisk) {
        riskScore = "High";
      } else if (hasMediumRisk) {
        riskScore = "Medium";
      }

      analysis = `Risk Score: ${riskScore}\nDetected ${filesChanged.length} changed files.`;
    } catch (e: any) {
      analysis = `Risk Score: ${riskScore}\nFailed to detect changes: ${e.message}`;
    }

    return {
      riskScore,
      analysis,
    };
  }
}
