import { logger } from "../utils/logger.js";

export class AnalyzeService {
  constructor(
    private workspaceRoot: string = process.cwd(),
    private logCallback: (msg: string) => void = () => {}
  ) {}

  public async analyzeProject(options: {
    deep?: boolean;
  }): Promise<{ projectType: string; suggestedTags: string[] }> {
    this.logCallback("Analyzing project...");
    logger.info({ options }, "Project analysis started");
    return {
      projectType: "TypeScript/Node",
      suggestedTags: ["backend", "api"],
    };
  }
}
