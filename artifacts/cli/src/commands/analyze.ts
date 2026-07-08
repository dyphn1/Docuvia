import {
  AnalyzeService,
  ExtractService,
  AstWorkerPool,
  DI_TOKENS,
  DI_KEYS,
  container,
} from "@workspace/core";
import process from "process";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";

export async function analyzeCommand(targetPath?: string, deep: boolean = false) {
  const workspaceRoot = process.cwd();

  // If a target path is provided, we perform a focused extraction (formerly the `extract` command)
  if (targetPath) {
    ui.header(UI_MESSAGES.ANALYZE_FOCUSED_HEADER);
    const spinner = ui.spinner(UI_MESSAGES.ANALYZE_FOCUSED_START + targetPath + "...").start();
    const workerPool = new AstWorkerPool();
    await workerPool.initialize(2);

    try {
      const extractService = container.resolve<ExtractService>(DI_TOKENS.ExtractService);
      (extractService as any)[DI_KEYS.WORKSPACE_ROOT] = workspaceRoot;
      (extractService as any)[DI_KEYS.WORKER_POOL] = workerPool;
      const result = await extractService.extractDecisions(targetPath);
      spinner.succeed(UI_MESSAGES.ANALYZE_FOCUSED_SUCCESS);
      result.decisions.forEach((decision) => ui.info(`- ${decision}`));
    } catch (error: any) {
      spinner.fail(UI_MESSAGES.ANALYZE_FOCUSED_FAIL + error.message);
      await workerPool.terminate();
      process.exit(1);
    }
    await workerPool.terminate();
    return;
  }

  // Otherwise, perform a full project analysis
  ui.header(UI_MESSAGES.ANALYZE_HEADER);
  const spinner = ui.spinner(UI_MESSAGES.ANALYZE_START).start();

  try {
    const analyzeService = container.resolve<AnalyzeService>(DI_TOKENS.AnalyzeService);
    (analyzeService as any)[DI_KEYS.WORKSPACE_ROOT] = workspaceRoot;
    (analyzeService as any)[DI_KEYS.LOG_CALLBACK] = (msg: string) => {
      spinner.text = msg;
    };

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
