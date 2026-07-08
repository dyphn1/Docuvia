import { logger } from "../utils/logger.js";

export class ChangeDetectionService {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public async detectChanges(baseRef?: string): Promise<{ analysis: string }> {
    logger.info({ baseRef }, "Detecting changes");
    return { analysis: "STUB: No changes detected" };
  }
}
