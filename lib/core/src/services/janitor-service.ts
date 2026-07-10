import { db } from "@workspace/db";
import { logger } from "../utils/logger.js";
import { errorReportsTable, jobQueueTable } from "@workspace/db";
import { lt } from "drizzle-orm";

export class JanitorService {
  async purgeOldLogsAndJobs(): Promise<void> {
    logger.info("Starting purge of old logs and jobs...");
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    try {
      await Promise.all([
        db.delete(errorReportsTable).where(lt(errorReportsTable.createdAt, sevenDaysAgo)),
        db.delete(jobQueueTable).where(lt(jobQueueTable.createdAt, sevenDaysAgo)),
      ]);
      logger.info("Successfully purged old error reports and jobs.");
    } catch (err) {
      logger.error({ err }, "Failed to purge old logs and jobs");
    }
  }
}
