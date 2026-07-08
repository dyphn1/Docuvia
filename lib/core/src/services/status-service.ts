import { logger } from "../utils/logger.js";

export class StatusService {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public async getStatus(): Promise<{ projects: number; l2Nodes: number; l3Nodes: number }> {
    logger.info("Getting status");
    // STUB
    return { projects: 1, l2Nodes: 5, l3Nodes: 10 };
  }
}
