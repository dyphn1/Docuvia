import os from "node:os";
import { Piscina } from "piscina";
import pLimit from "p-limit";
import { logger } from "../logger.js";
import { isQuarantined, quarantineFile } from "./quarantine-db.js";

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

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 500);

    try {
      const result = await this.pool.run(filePath, { signal: ac.signal });
      clearTimeout(timeout);
      return result;
    } catch (error: any) {
      clearTimeout(timeout);
      quarantineFile(filePath);
      logger.warn(
        { filePath, error: error.message },
        "AST Worker failed or timed out. Quarantining file."
      );
      return { status: "error", reason: error.message || "Worker error" };
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
