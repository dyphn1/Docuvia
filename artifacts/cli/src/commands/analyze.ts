import { AnalyzeService } from "@workspace/core";
import process from "process";

export async function analyzeCommand() {
  const workspaceRoot = process.cwd();
  const analyzeService = new AnalyzeService(workspaceRoot);
  try {
    const result = await analyzeService.analyzeProject();
    console.log(`Project type: ${result.projectType}`);
    console.log(`Suggested tags: ${result.suggestedTags.join(", ")}`);
  } catch (error: any) {
    console.error("Analysis failed:", error.message);
    process.exit(1);
  }
}
