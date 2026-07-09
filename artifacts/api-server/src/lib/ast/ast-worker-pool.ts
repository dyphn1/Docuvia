import { MAX_UPLOAD_FILE_SIZE_BYTES } from "@workspace/core";
import { AST_STATUS } from "@workspace/core";
import os from "node:os";
import fs from "node:fs/promises";
import { Piscina } from "piscina";
import pLimit from "p-limit";
import { logger } from "@workspace/core";
import { isQuarantined, quarantineFile } from "./quarantine-db.js";
import { db } from "@workspace/db";
import { errorReportsTable } from "@workspace/db";
import { AST_INGESTION_DEFAULTS } from "../../constants/index.js";

const maxThreads = Math.max(1, os.cpus().length - 1);

const isTsNode = typeof process !== "undefined" && (process.env.VITEST || process.env.TS_NODE_DEV);
// If bundled by esbuild, it will be in the same output directory as the bundle (dist/index.mjs -> dist/ast-worker.mjs)
const workerFile = isTsNode ? "./ast-worker.ts" : "./ast-worker.mjs";
const workerPath = new URL(workerFile, import.meta.url).href;

export interface ParseResult {
  status: typeof AST_STATUS.DONE | typeof AST_STATUS.ERROR;
  file?: string;
  reason?: string;
}

export class AstWorkerPool {
  private pool: Piscina;
  private limit = pLimit(AST_INGESTION_DEFAULTS.MAX_CONCURRENT_IN_FLIGHT);

  constructor() {
    this.pool = new Piscina({
      filename: workerPath,
      maxThreads,
    });
  }

  /**
   * Helper to write a detailed error report to the dead-letter queue (error_reports db table).
   */
  private async persistErrorReport(taskType: string, message: string): Promise<void> {
    await db
      .insert(errorReportsTable)
      .values({
        projectId: AST_INGESTION_DEFAULTS.DEFAULT_PROJECT_ID,
        taskType,
        errorMessage: message,
      })
      .catch((err: unknown) => logger.warn({ err }, "Failed to persist error report"));
  }

  private async runWithTimeout(filePath: string): Promise<ParseResult> {
    if (isQuarantined(filePath)) {
      return { status: AST_STATUS.ERROR, reason: AST_INGESTION_DEFAULTS.MSG_FILE_QUARANTINED };
    }

    try {
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
        quarantineFile(filePath);
        logger.warn(
          { filePath, size: stats.size },
          "File exceeds maximum size limit. Quarantining file."
        );

        await this.persistErrorReport(
          AST_INGESTION_DEFAULTS.TASK_TYPE_AST_PARSE,
          `File exceeds maximum size limit (10MB): ${filePath}`
        );

        return { status: AST_STATUS.ERROR, reason: AST_INGESTION_DEFAULTS.MSG_FILE_LIMIT_EXCEEDED };
      }
    } catch (err: any) {
      return { status: AST_STATUS.ERROR, reason: `Failed to stat file: ${err.message}` };
    }

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), AST_INGESTION_DEFAULTS.DEFAULT_TIMEOUT_MS); // 2 second max timeout to prevent infinite loops

    try {
      const result = await this.pool.run(filePath, { signal: ac.signal });
      clearTimeout(timeout);
      return result;
    } catch (error: any) {
      clearTimeout(timeout);
      quarantineFile(filePath);

      const errorMessage = error.message || "Worker error";
      await this.persistErrorReport(
        AST_INGESTION_DEFAULTS.TASK_TYPE_AST_POISON_PILL,
        `Poison Pill caught: ${errorMessage} in ${filePath}`
      );

      logger.warn(
        { filePath, error: errorMessage },
        "AST Worker failed or timed out. Quarantining file and persisting DLQ."
      );
      return { status: AST_STATUS.ERROR, reason: errorMessage };
    }
  }

  /**
   * Dispatch a list of file paths to be parsed by the worker pool.
   * Uses ACK Protocol / Semaphore Bounded Dispatch implicitly via Piscina queue/threads.
   * Returns an array of results indicating the temporary .jsonl file paths.
   */
  async dispatch(filePaths: string[]): Promise<ParseResult[]> {
    logger.info(
      { fileCount: filePaths.length, maxThreads },
      "Dispatching files to AST Worker Pool"
    );

    const promises = filePaths.map((filePath) => this.limit(() => this.runWithTimeout(filePath)));
    const results = await Promise.all(promises);

    logger.info({ fileCount: filePaths.length }, "Completed AST processing for files");
    return results;
  }
}
