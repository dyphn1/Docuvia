import { AnalyzeService, ExtractService, AstWorkerPool, DI_TOKENS, DI_KEYS } from "@workspace/core";
import process from "process";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { resolveConfiguredService } from "../utils/resolve-service.js";

async function runFocusedExtraction(targetPath: string, workspaceRoot: string): Promise<void> {
  ui.header(UI_MESSAGES.ANALYZE_FOCUSED_HEADER);
  const spinner = ui.spinner(UI_MESSAGES.ANALYZE_FOCUSED_START + targetPath + "...").start();
  const workerPool = new AstWorkerPool();
  await workerPool.initialize(2);

  try {
    const extractService = resolveConfiguredService<ExtractService>(DI_TOKENS.ExtractService, {
      [DI_KEYS.WORKSPACE_ROOT]: workspaceRoot,
      [DI_KEYS.WORKER_POOL]: workerPool,
    });
    const result = await extractService.extractDecisions(targetPath);
    spinner.succeed(UI_MESSAGES.ANALYZE_FOCUSED_SUCCESS);
    if (result.decisions.length === 0) {
      ui.info("No decision-worthy content found.");
    }
    result.decisions.forEach((decision) => {
      ui.info(`[${decision.nodeType}] ${decision.title} (confidence: ${decision.confidence})`);
      if (decision.content) {
        console.log(`    ${decision.content}`);
      }
    });
  } catch (error: any) {
    spinner.fail(UI_MESSAGES.ANALYZE_FOCUSED_FAIL + error.message);
    await workerPool.terminate();
    process.exit(1);
  }
  await workerPool.terminate();
}

async function runFullAnalysis(deep: boolean, workspaceRoot: string): Promise<void> {
  ui.header(UI_MESSAGES.ANALYZE_HEADER);
  const spinner = ui.spinner(UI_MESSAGES.ANALYZE_START).start();

  try {
    const analyzeService = resolveConfiguredService<AnalyzeService>(DI_TOKENS.AnalyzeService, {
      [DI_KEYS.WORKSPACE_ROOT]: workspaceRoot,
      [DI_KEYS.LOG_CALLBACK]: (msg: string) => {
        spinner.text = msg;
      },
    });

    const result = await analyzeService.analyzeProject({ deep });
    spinner.succeed(UI_MESSAGES.ANALYZE_SUCCESS);

    // Structured Output
    console.log("");
    ui.success(UI_MESSAGES.ANALYZE_PROJECT_TYPE + result.projectType);
    ui.info(
      UI_MESSAGES.ANALYZE_SUGGESTED_TAGS +
        (result.suggestedTags.join(", ") || UI_MESSAGES.ANALYZE_NONE)
    );
    console.log("");
  } catch (error: any) {
    spinner.fail(UI_MESSAGES.ANALYZE_FAIL + error.message);
    process.exit(1);
  }
}

export async function analyzeCommand(
  targetPath?: string,
  deep: boolean = false,
  workspaceRoot: string = process.cwd()
): Promise<void> {
  // A target path performs a focused extraction (formerly the `extract` command);
  // otherwise we run a full project analysis.
  if (targetPath) {
    await runFocusedExtraction(targetPath, workspaceRoot);
    return;
  }
  await runFullAnalysis(deep, workspaceRoot);
}
