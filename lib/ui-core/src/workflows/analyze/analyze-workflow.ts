import { docuviaFactory, TOKENS, type ILogger } from "@workspace/contracts";
import { ANALYZE_MESSAGES } from "./analyze-messages.js";
import { appendAnalyzeLogLine } from "./analyze-log-writer.js";
import type { AnalyzeResult } from "./analyze-result.js";

/**
 * The `analyze` workflow — the config-scan half only (see old Docuvia's `AnalyzeService.analyzeProject`).
 * The LLM/decision-extraction half (old Docuvia's focused `extract` path) is explicitly out of
 * scope and tracked separately.
 */
export class AnalyzeWorkflow {
  constructor(
    private readonly workspaceRoot: string,
    private readonly logger: ILogger,
  ) {}

  public async execute(): Promise<AnalyzeResult> {
    const { workspaceRoot, logger } = this;

    logger.info(ANALYZE_MESSAGES.ANALYZING);
    await appendAnalyzeLogLine(workspaceRoot, { event: "analyze.start" });

    const configScanner = docuviaFactory.resolve(TOKENS.ConfigScanner, {
      logger,
    });
    const { projectType, tags } =
      await configScanner.scanConfigs(workspaceRoot);

    const result: AnalyzeResult = { projectType, suggestedTags: tags };
    await appendAnalyzeLogLine(workspaceRoot, {
      event: "analyze.summary",
      ...result,
    });
    return result;
  }
}
