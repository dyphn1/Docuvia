import { db, jobQueueTable, projectsTable, errorReportsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ingestAstBatch, logger } from "@workspace/core";

export interface AstIngestionResult {
  message: string;
  jobId: number;
  mode: string;
}

export class AstIngestionService {
  async dispatchAstIngestion(
    projectId: number,
    paths: string | string[] | Array<{ filePath: string; oldPath?: string }>,
    mode: "full" | "incremental"
  ): Promise<AstIngestionResult> {
    const pathArray = Array.isArray(paths) ? paths : [paths];

    const [job] = await db
      .insert(jobQueueTable)
      .values({
        taskType: "ast_ingest",
        payload: { jsonlPaths: pathArray, projectId, mode },
      })
      .returning();

    process.nextTick(async () => {
      try {
        await db
          .update(jobQueueTable)
          .set({ status: "processing", lockedAt: new Date() })
          .where(eq(jobQueueTable.id, job.id));

        const stringPaths = pathArray.map((p) => (typeof p === "string" ? p : p.filePath));
        const result = await ingestAstBatch(stringPaths, projectId, {
          incremental: mode === "incremental",
        });

        if (mode === "full" || result.l2Created > 0 || result.l3Created > 0) {
          await db
            .update(projectsTable)
            .set({ lastAstIngestedAt: new Date() })
            .where(eq(projectsTable.id, projectId));
        }

        await db
          .update(jobQueueTable)
          .set({
            status: "completed",
            payload: { jsonlPaths: pathArray, projectId, mode, result },
          })
          .where(eq(jobQueueTable.id, job.id));
      } catch (err: unknown) {
        logger.error({ err, jobId: job.id, projectId }, "AST ingestion background job failed");

        await db
          .update(jobQueueTable)
          .set({ status: "failed" })
          .where(eq(jobQueueTable.id, job.id));

        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : undefined;
        await db
          .insert(errorReportsTable)
          .values({
            projectId,
            jobId: job.id,
            taskType: "ast_ingest_job",
            errorMessage,
            errorStack,
          })
          .catch((dlqErr) => logger.warn({ dlqErr }, "Failed to persist DLQ for AST Job"));
      }
    });

    return {
      message: "AST ingestion job dispatched successfully",
      jobId: job.id,
      mode,
    };
  }
}
