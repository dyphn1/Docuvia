import os from "node:os";
import fs from "node:fs/promises";
import { Piscina } from "piscina";
import pLimit from "p-limit";
import { logger } from "@workspace/core";
import { isQuarantined, quarantineFile } from "./quarantine-db.js";
import { db } from "@workspace/db";
import { errorReportsTable } from "@workspace/db";

const maxThreads = Math.max(1, os.cpus().length - 1);

const isTsNode = typeof process !== "undefined" && (process.env.VITEST || process.env.TS_NODE_DEV);
// If bundled by esbuild, it will be in the same output directory as the bundle (dist/index.mjs -> dist/ast-worker.mjs)
const workerFile = isTsNode ? "./ast-worker.ts" : "./ast-worker.mjs";
const workerPath = new URL(workerFile, import.meta.url).href;

export interface ParseResult {
  status: "done" | "error";
  file?: string;
  reason?: string;
}

export class AstWorkerPool {
  private pool: Piscina;
  private maxInFlight = 100;

  constructor() {
    this.pool = new Piscina({
      filename: workerPath,
      maxThreads,
    });
  }

  private async runWithTimeout(filePath: string): Promise<ParseResult> {
    if (isQuarantined(filePath)) {
      return { status: "error", reason: "File is quarantined" };
    }

    try {
      const stats = await fs.stat(filePath);
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
      if (stats.size > MAX_FILE_SIZE) {
        quarantineFile(filePath);
        logger.warn(
          { filePath, size: stats.size },
          "File exceeds maximum size limit. Quarantining file."
        );

        await db
          .insert(errorReportsTable)
          .values({
            projectId: 1, // Fallback since we don't have project context in pool directly
            taskType: "ast_parse",
            errorMessage: `File exceeds maximum size limit (10MB): ${filePath}`,
          })
          .catch((err) => logger.warn({ err }, "Failed to persist error report"));

        return { status: "error", reason: "File exceeds maximum size limit (10MB)" };
      }
    } catch (err: any) {
      return { status: "error", reason: `Failed to stat file: ${err.message}` };
    }

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 2000); // 2 second max timeout to prevent infinite loops

    try {
      const result = await this.pool.run(filePath, { signal: ac.signal });
      clearTimeout(timeout);
      return result;
    } catch (error: any) {
      clearTimeout(timeout);
      quarantineFile(filePath);

      const errorMessage = error.message || "Worker error";
      await db
        .insert(errorReportsTable)
        .values({
          projectId: 1, // Fallback project context
          taskType: "ast_parse_poison_pill",
          errorMessage: `Poison Pill caught: ${errorMessage} in ${filePath}`,
        })
        .catch((err) => logger.warn({ err }, "Failed to persist error report"));

      logger.warn(
        { filePath, error: errorMessage },
        "AST Worker failed or timed out. Quarantining file and persisting DLQ."
      );
      return { status: "error", reason: errorMessage };
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

    const limit = pLimit(this.maxInFlight);
    const promises = filePaths.map((filePath) => limit(() => this.runWithTimeout(filePath)));
    const results = await Promise.all(promises);

    logger.info({ fileCount: filePaths.length }, "Completed AST processing for files");
    return results;
  }
}
