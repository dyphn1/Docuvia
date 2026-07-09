import { logger } from "../utils/logger.js";
import { IConfigScanner } from "../interfaces/analyzer.interfaces.js";
import { ConfigScannerService } from "./config-scanner.service.js";

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

    const { projectType, tags } = await this.configScanner.scanConfigs(this.workspaceRoot);

    return {
      projectType,
      suggestedTags: tags,
    };
  }
}
