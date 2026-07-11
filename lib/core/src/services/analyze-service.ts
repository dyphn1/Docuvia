import { logger } from "../utils/logger.js";
import { IConfigScanner } from "../interfaces/analyzer.interfaces.js";
import { ConfigScannerService } from "./config-scanner.service.js";
import { appendCommandLogLine } from "./command-log-writer.js";
import { ANALYZE_LOG_FILE_NAME } from "../constants/paths.js";

export class AnalyzeService {
  constructor(
    private workspaceRoot: string = process.cwd(),
    private logCallback: (msg: string) => void = () => {},
    private configScanner: IConfigScanner = new ConfigScannerService()
  ) {}

  public async analyzeProject(
    options: { deep?: boolean } = {}
  ): Promise<{ projectType: string; suggestedTags: string[] }> {
    this.logCallback("Analyzing project...");
    logger.info({ options }, "Project analysis started");
    await appendCommandLogLine(this.workspaceRoot, ANALYZE_LOG_FILE_NAME, {
      event: "analyze.start",
      deep: options.deep ?? false,
    }).catch(() => {});

    const { projectType, tags } = await this.configScanner.scanConfigs(this.workspaceRoot);

    const result = { projectType, suggestedTags: tags };
    await appendCommandLogLine(this.workspaceRoot, ANALYZE_LOG_FILE_NAME, {
      event: "analyze.summary",
      ...result,
    }).catch(() => {});

    return result;
  }
}
