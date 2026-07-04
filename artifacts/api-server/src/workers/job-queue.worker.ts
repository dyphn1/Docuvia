import { db, jobQueueTable } from "@workspace/db";
import { eq, and, isNull, lt } from "drizzle-orm";
import { logger } from "@workspace/core";
import { writeKnowledgeToOrphanBranch } from "@workspace/core";

const POLL_INTERVAL = 5000;

export class JobQueueWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL);
    logger.info("JobQueueWorker started");
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // 1. Find pending jobs or stalled jobs (locked more than 10 mins ago)
      const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);

      const jobs = await db
        .select()
        .from(jobQueueTable)
        .where(eq(jobQueueTable.status, "pending"))
        .limit(5);

      for (const job of jobs) {
        // Optimistic lock
        const locked = await db
          .update(jobQueueTable)
          .set({ status: "processing", lockedAt: new Date() })
          .where(and(eq(jobQueueTable.id, job.id), eq(jobQueueTable.status, "pending")))
          .returning();

        if (locked.length === 0) continue; // Someone else got it

        try {
          await this.processJob(job);

          await db
            .update(jobQueueTable)
            .set({ status: "completed" })
            .where(eq(jobQueueTable.id, job.id));
        } catch (err) {
          logger.error({ err, jobId: job.id }, "Job processing failed");
          await db
            .update(jobQueueTable)
            .set({ status: "failed" })
            .where(eq(jobQueueTable.id, job.id));
        }
      }
    } catch (err) {
      logger.error({ err }, "JobQueueWorker tick failed");
    } finally {
      this.isRunning = false;
    }
  }

  private async processJob(job: any) {
    logger.info({ jobId: job.id, taskType: job.taskType }, "Processing job");

    if (job.taskType === "sync_orphan_branch") {
      const projectId = job.payload?.projectId;
      if (projectId) {
        await writeKnowledgeToOrphanBranch(projectId);
      }
    }
    // Other task types can be handled here...
  }
}

export const jobQueueWorker = new JobQueueWorker();
