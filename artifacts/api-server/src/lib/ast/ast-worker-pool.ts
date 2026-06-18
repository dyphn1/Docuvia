import os from 'node:os';
import { Piscina } from 'piscina';
import { logger } from '../logger.js';

const maxThreads = Math.max(1, os.cpus().length - 1);

const isTsNode = typeof process !== 'undefined' && (process.env.VITEST || process.env.TS_NODE_DEV);
// If bundled by esbuild, it will be in the same output directory as the bundle (dist/index.mjs -> dist/ast-worker.mjs)
const workerFile = isTsNode ? './ast-worker.ts' : './ast-worker.mjs';
const workerPath = new URL(workerFile, import.meta.url).href;

export class AstWorkerPool {
  private pool: Piscina;

  constructor() {
    this.pool = new Piscina({
      filename: workerPath,
      maxThreads,
    });
  }

  /**
   * Dispatch a list of file paths to be parsed by the worker pool.
   * Uses ACK Protocol / Semaphore Bounded Dispatch implicitly via Piscina queue/threads.
   * Returns an array of results indicating the temporary .jsonl file paths.
   */
  async dispatch(filePaths: string[]): Promise<Array<{ status: string; file: string }>> {
    logger.info({ fileCount: filePaths.length, maxThreads }, 'Dispatching files to AST Worker Pool');
    
    const promises = filePaths.map((filePath) => this.pool.run(filePath));
    const results = await Promise.all(promises);
    
    logger.info({ fileCount: filePaths.length }, 'Completed AST processing for files');
    return results;
  }
}
