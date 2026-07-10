import { ENCODING_HEX, ENCODING_BASE64, HASH_ALGO_SHA256, HASH_ALGO_MD5 } from "@workspace/core";
import { Worker } from "worker_threads";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import crypto from "node:crypto";
import { AstParseRequest, AstParseResponse } from "../workers/ast-worker.js";
import { IAsxParseCache } from "../interfaces/ast-ingestion.interfaces.js";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface IASTWorkerPool {
  initialize(workerCount?: number): Promise<void>;
  parse(request: Omit<AstParseRequest, "taskId">): Promise<AstParseResponse>;
  terminate(): Promise<void>;
}

export class AstWorkerCrashError extends Error {
  constructor(
    public readonly filePath: string | undefined,
    public readonly cause: unknown
  ) {
    super(
      `AST worker crashed while parsing ${filePath ?? "(unknown file)"}: ` +
        (cause instanceof Error ? cause.message : String(cause))
    );
    this.name = "AstWorkerCrashError";
  }
}

export class AstWorkerPool implements IASTWorkerPool {
  private workers: Worker[] = [];
  private workerTasks = new Map<Worker, string>();
  private workerOptions: any = {};
  private wPath: string = "";
  private workerQueue: Worker[] = [];
  // Serializes worker creation so we never fire off N `new Worker()` calls in the same
  // synchronous loop iteration (every spawn, including crash-triggered respawns, goes
  // through this chain). NOTE: this turned out NOT to be the fix for the "13 AstWorkerPool
  // crashes" documented in docs/analysis/docuvia-cli-vs-gitnexus-2026-07-10.md — that was
  // root-caused to a logging bug (see handleError below): normal pool.terminate() shutdown
  // was being misreported as crashes, regardless of spawn timing. A staggered-delay variant
  // of this queue was tried and verified (against a real 4,236-file run) to make no
  // difference either way. Kept as a cheap, harmless structural safeguard against a literal
  // spawn burst, but the actual fix lives in handleError's `shuttingDown` check.
  private spawnChain: Promise<void> = Promise.resolve();
  private taskQueue: Array<{
    request: Omit<AstParseRequest, "taskId">;
    resolve: (val: AstParseResponse) => void;
    reject: (err: any) => void;
  }> = [];
  private taskCounter = 0;
  private pendingTasks = new Map<
    string,
    { resolve: (val: AstParseResponse) => void; reject: (err: any) => void }
  >();
  private taskTimeouts = new Map<string, NodeJS.Timeout>();
  private taskFilePaths = new Map<string, string>();
  private timedOutWorkers = new WeakSet<Worker>();
  private shuttingDown = false;

  constructor(
    private readonly taskTimeoutMs: number = 30_000,
    private cache?: IAsxParseCache,
    private readonly workerScriptPathOverride?: string
  ) {}

  /** Queues a worker spawn behind any spawn already in flight — see `spawnChain` above. */
  private enqueueSpawn(): Promise<void> {
    this.spawnChain = this.spawnChain.then(async () => {
      this.spawnWorker();
      // Yield one tick so N queued spawns can't collapse back into a single synchronous
      // burst — see the `spawnChain` comment for why this is deliberately not a real delay.
      await new Promise((resolve) => setImmediate(resolve));
    });
    return this.spawnChain;
  }

  private spawnWorker(): Worker {
    const worker = new Worker(this.wPath, this.workerOptions);

    worker.on("message", (res: AstParseResponse) => {
      this.workerTasks.delete(worker);
      const timeout = this.taskTimeouts.get(res.taskId);
      if (timeout) {
        clearTimeout(timeout);
        this.taskTimeouts.delete(res.taskId);
      }
      const promiseCallbacks = this.pendingTasks.get(res.taskId);
      if (promiseCallbacks) {
        this.pendingTasks.delete(res.taskId);
        this.taskFilePaths.delete(res.taskId);
        promiseCallbacks.resolve(res);
      }

      this.workerQueue.push(worker);
      this.processQueue();
    });

    const handleError = (err: any) => {
      const timedOut = this.timedOutWorkers.delete(worker);
      const taskId = this.workerTasks.get(worker);
      const filePath = taskId ? this.taskFilePaths.get(taskId) : undefined;

      if (this.shuttingDown) {
        // pool.terminate() forcibly stops every still-alive worker via worker.terminate(),
        // and Node reports that as a non-zero "exit" event (verified directly: an idle,
        // never-used worker.terminate() exits with code 1) even though nothing went wrong.
        // This is the actual explanation for the "13 AstWorkerPool crashes" documented in
        // docs/analysis/docuvia-cli-vs-gitnexus-2026-07-10.md — os.cpus().length - 1 workers
        // are still alive and idle when processFiles() finishes and calls pool.terminate(),
        // and every one of them was being misreported as a crash. Log at debug, not error.
        logger.debug({ taskId, filePath }, "AST worker exited during pool shutdown (expected)");
      } else {
        logger.error(
          {
            taskId,
            filePath,
            hadInFlightTask: Boolean(taskId),
            err:
              err instanceof Error
                ? { message: err.message, stack: err.stack, name: err.name }
                : err,
          },
          "AST worker crashed/exited"
        );
      }
      if (taskId) {
        const timeout = this.taskTimeouts.get(taskId);
        if (timeout) {
          clearTimeout(timeout);
          this.taskTimeouts.delete(taskId);
        }
        const callbacks = this.pendingTasks.get(taskId);
        if (callbacks) {
          callbacks.reject(
            new AstWorkerCrashError(
              filePath,
              timedOut
                ? new Error(`AST worker task ${taskId} timed out after ${this.taskTimeoutMs}ms`)
                : err || new Error("Worker exited unexpectedly")
            )
          );
          this.pendingTasks.delete(taskId);
        }
        this.workerTasks.delete(worker);
        this.taskFilePaths.delete(taskId);
      }

      // Remove from pool
      this.workers = this.workers.filter((w) => w !== worker);
      this.workerQueue = this.workerQueue.filter((w) => w !== worker);

      // Respawn — but not while shutting down, else terminate() would leak a fresh
      // replacement worker for every one it just terminated. Routed through the same
      // spawn queue as initialize() so a burst of near-simultaneous crashes doesn't just
      // recreate the thundering-herd respawn cluster it's meant to prevent.
      if (!this.shuttingDown) {
        this.enqueueSpawn();
      }
    };

    worker.on("error", handleError);
    worker.on("exit", (code) => {
      if (code !== 0) handleError(new Error(`Worker exited with code ${code}`));
    });

    this.workers.push(worker);
    this.workerQueue.push(worker);

    return worker;
  }

  async initialize(workerCount: number = 2): Promise<void> {
    if (this.workerScriptPathOverride) {
      // Test-only seam: bypass the dist/ts resolution below entirely so tests can point
      // the pool at a fixture worker script (e.g. one that deterministically crashes).
      this.wPath = this.workerScriptPathOverride;
      this.workerOptions.execArgv = process.execArgv.filter(
        (arg) => !arg.includes("--eval") && !arg.includes("--print")
      );
      if (!this.workerOptions.execArgv.some((arg: string) => arg.includes("tsx"))) {
        this.workerOptions.execArgv.push("--import", "tsx");
      }
      for (let i = 0; i < workerCount; i++) {
        await this.enqueueSpawn();
      }
      return;
    }

    // Determine if we are in .ts environment (tsx) or .js environment (dist)
    let isTs = false;
    this.wPath = path.resolve(__dirname, "../workers/ast-worker.js");

    if (!fs.existsSync(this.wPath)) {
      this.wPath = path.resolve(__dirname, "../workers/ast-worker.ts");
      isTs = true;
    }

    if (isTs) {
      // Inherit the exact tsx loader from the parent process, filtering out any script-specific args
      this.workerOptions.execArgv = process.execArgv.filter(
        (arg) => !arg.includes("--eval") && !arg.includes("--print")
      );
      if (!this.workerOptions.execArgv.some((arg: string) => arg.includes("tsx"))) {
        this.workerOptions.execArgv.push("--import", "tsx");
      }
    } else {
      // If running from dist/ast-worker.js, we don't need any loaders.
      this.workerOptions.execArgv = [];
    }

    for (let i = 0; i < workerCount; i++) {
      await this.enqueueSpawn();
    }
  }

  parse(request: Omit<AstParseRequest, "taskId">): Promise<AstParseResponse> {
    return new Promise((resolve, reject) => {
      // Compute content hash for cache lookup
      const contentHash = crypto
        .createHash(HASH_ALGO_SHA256)
        .update(request.code)
        .digest(ENCODING_HEX);

      // Check cache first with timing instrumentation
      if (this.cache) {
        const cacheStartTime = performance.now();
        const cachedResult = this.cache.get(contentHash);
        const cacheLookupTime = performance.now() - cacheStartTime;

        if (cachedResult) {
          logger.debug(
            { contentHash, cacheLookupTimeMs: cacheLookupTime.toFixed(2) },
            "AST parse cache hit"
          );
          resolve(cachedResult);
          return;
        }
      }

      // Queue for worker processing
      const queuedAt = Date.now();
      this.taskQueue.push({
        request,
        resolve: (result: AstParseResponse) => {
          // Cache the result before resolving
          if (this.cache) {
            this.cache.set(contentHash, result);
            const metrics = this.cache.metrics;
            if (metrics.hits + metrics.misses > 0 && (metrics.hits + metrics.misses) % 100 === 0) {
              const hitRate = (metrics.hits / (metrics.hits + metrics.misses)) * 100;
              const queueWaitTime = Date.now() - queuedAt;
              logger.info(
                {
                  hitRate: hitRate.toFixed(2),
                  queueWaitTimeMs: queueWaitTime,
                  ...metrics,
                },
                "AST cache metrics and queue performance"
              );
            }
          }
          resolve(result);
        },
        reject,
      });
      this.processQueue();
    });
  }

  private processQueue() {
    if (this.taskQueue.length === 0 || this.workerQueue.length === 0) {
      return;
    }

    const task = this.taskQueue.shift()!;
    const worker = this.workerQueue.shift()!;

    const taskId = String(++this.taskCounter);
    this.pendingTasks.set(taskId, { resolve: task.resolve, reject: task.reject });
    this.workerTasks.set(worker, taskId);
    this.taskFilePaths.set(taskId, task.request.filePath);

    const timeout = setTimeout(() => {
      this.taskTimeouts.delete(taskId);
      this.timedOutWorkers.add(worker);
      logger.error(
        { taskId, filePath: this.taskFilePaths.get(taskId), taskTimeoutMs: this.taskTimeoutMs },
        "AST worker task timed out — terminating stuck worker"
      );
      // Deliberate termination; the worker's own "exit" handler rejects the pending task,
      // removes it from the pool, and respawns a replacement (Issue 1.10).
      worker.terminate().catch(() => {});
    }, this.taskTimeoutMs);
    this.taskTimeouts.set(taskId, timeout);

    worker.postMessage({ ...task.request, taskId });
  }

  async terminate(): Promise<void> {
    this.shuttingDown = true;
    for (const timeout of this.taskTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.taskTimeouts.clear();
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.workerQueue = [];
  }
}

// Legacy compatibility for vscode-client
export async function shutdownGlobalWorkerPool(): Promise<void> {
  // no-op placeholder
}
