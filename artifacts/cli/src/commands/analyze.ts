import { AnalyzeService, ExtractService, AstWorkerPool } from "@workspace/core";
import process from "process";
import { ui } from "../ui/wizard.js";

export async function analyzeCommand(targetPath?: string, deep: boolean = false) {
  const workspaceRoot = process.cwd();

  // If a target path is provided, we perform a focused extraction (formerly the `extract` command)
  if (targetPath) {
    ui.header(`Analyze (Focused Extraction)`);
    const spinner = ui.spinner(`Extracting knowledge from ${targetPath}...`).start();
    const workerPool = new AstWorkerPool();
    await workerPool.initialize(2);

    const extractService = new ExtractService(workspaceRoot, workerPool);
    try {
      const result = await extractService.extractDecisions(targetPath);
      spinner.succeed(`Extraction complete`);
      result.decisions.forEach((decision) => ui.info(`- ${decision}`));
    } catch (error: any) {
      spinner.fail(`Extraction failed: ${error.message}`);
      await workerPool.terminate();
      process.exit(1);
    }
    await workerPool.terminate();
    return;
  }

  // Otherwise, perform a full project analysis
  ui.header("Analyze Workspace");
  const spinner = ui.spinner("Initializing analyzer...").start();

  const analyzeService = new AnalyzeService(workspaceRoot, (msg: string) => {
    spinner.text = msg;
  });

  try {
    const result = await analyzeService.analyzeProject({ deep });
    spinner.succeed(`Analysis complete`);

    // Structured Output
    console.log("");
    ui.success(`Project Type: ${result.projectType}`);
    ui.info(`Suggested Tags: ${result.suggestedTags.join(", ") || "None"}`);
    console.log("");
  } catch (error: any) {
    spinner.fail(`Analysis failed: ${error.message}`);
    process.exit(1);
  }
}
