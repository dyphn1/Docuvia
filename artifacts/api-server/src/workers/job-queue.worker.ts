import { db, jobQueueTable } from "@workspace/db";
import { eq, and, isNull, lt } from "drizzle-orm";
import { logger } from "@workspace/core";
import { writeKnowledgeToOrphanBranch } from "@workspace/core";
import {
  JOB_QUEUE_POLL_INTERVAL_MS,
  JOB_QUEUE_STALL_TIMEOUT_MS,
  JOB_QUEUE_LIMIT,
  JOB_STATUS,
  JOB_TASK_TYPES,
} from "../constants/index.js";

export class JobQueueWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), JOB_QUEUE_POLL_INTERVAL_MS);
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
      const tenMinsAgo = new Date(Date.now() - JOB_QUEUE_STALL_TIMEOUT_MS);

      const jobs = await db
        .select()
        .from(jobQueueTable)
        .where(eq(jobQueueTable.status, JOB_STATUS.PENDING))
        .limit(JOB_QUEUE_LIMIT);

      for (const job of jobs) {
        // Optimistic lock
        const locked = await db
          .update(jobQueueTable)
          .set({ status: JOB_STATUS.PROCESSING, lockedAt: new Date() })
          .where(and(eq(jobQueueTable.id, job.id), eq(jobQueueTable.status, JOB_STATUS.PENDING)))
          .returning();

        if (locked.length === 0) continue; // Someone else got it

        try {
          await this.processJob(job);

          await db
            .update(jobQueueTable)
            .set({ status: JOB_STATUS.COMPLETED })
            .where(eq(jobQueueTable.id, job.id));
        } catch (err) {
          logger.error({ err, jobId: job.id }, "Job processing failed");
          await db
            .update(jobQueueTable)
            .set({ status: JOB_STATUS.FAILED })
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

    if (job.taskType === JOB_TASK_TYPES.SYNC_ORPHAN_BRANCH) {
      const projectId = job.payload?.projectId;
      if (projectId) {
        await writeKnowledgeToOrphanBranch(projectId);
      }
    }
    // Other task types can be handled here...
  }
}

export const jobQueueWorker = new JobQueueWorker();
