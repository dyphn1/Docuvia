import { logger } from "../utils/logger.js";

export class SyncService {
  constructor(
    private workspaceRoot: string = process.cwd(),
    private apiUrl: string = "",
    private pat: string = "",
    private logCallback: (msg: string) => void = () => {}
  ) {}

  public async sync(projectId: string, commitSha?: string): Promise<void> {
    this.logCallback(`Starting sync for project ${projectId}...`);
    logger.info({ projectId, commitSha }, "Syncing to remote");
    // STUB
  }
}
