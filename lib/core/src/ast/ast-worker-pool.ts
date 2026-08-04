import { ENCODING_HEX, HASH_ALGO_SHA256 } from "../constants/encoding.js";
import { Worker } from "worker_threads";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import crypto from "node:crypto";
import type { AstParseRequest, AstParseResponse } from "./ast-worker.js";
import type { ILogger, IIpcLogMessage } from "@workspace/contracts";
import { createNoopLogger, IpcLogRouter } from "@workspace/contracts";
import { AST_WORKER_CRASH_ERROR_NAME, AstMessages } from "./ast-constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** esbuild options for `compileWorkerForDevMode()` below — literal values dictated by esbuild's own API. */
const DevWorkerBuildConfig = {
  FORMAT: "esm",
  PLATFORM: "node",
  TARGET: "node20",
  EXTERNAL_TREE_SITTER: "web-tree-sitter",
} as const;

/**
 * Node `execArgv` flags manipulated by `initialize()`'s test-only fixture seam: the test runner's
 * own `--eval`/`--print` flags must be stripped before respawning workers against a fixture
 * script, and `--import tsx` re-registers the `tsx` ESM loader for that fixture worker.
 */
const NodeExecArgvFlags = {
  EVAL: "--eval",
  PRINT: "--print",
  IMPORT: "--import",
  TSX_LOADER: "tsx",
} as const;

/**
 * Compiles `ast-worker.ts` into a real, standalone `ast-worker.js` sitting right next to it, for
 * dev/test runs where `dist/`'s own pre-built worker (built as its own tsup entry — see
 * artifacts/cli/tsup.config.ts) doesn't exist yet.
 *
 * This exists because tsx's `.js`-to-`.ts` resolve hook — the one that lets the *main* thread
 * transparently run TypeScript from source — does not propagate into `worker_threads`, on any
 * Node/tsx version tested (confirmed empirically: identical failure whether the loader is passed
 * as an absolute file:// URL, the bare "tsx" specifier, or the documented "tsx/esm" register
 * entry point). Spawning a raw `.ts` worker with that loader inherited via `execArgv` reliably
 * throws `ERR_MODULE_NOT_FOUND` on the first relative import that needs the remap — not just in
 * this file, but in every relatively-imported module reachable from it (e.g. `@workspace/contracts`'s
 * own internal `./logging/logger.js`-style re-exports), so there is no finite set of individual
 * imports to work around. Compiling once, up front, sidesteps the whole class of problem the same
 * way the production build does — just lazily, for dev/test instead of via a separate build step.
 *
 * `web-tree-sitter` is kept external rather than bundled: it locates its own `tree-sitter.wasm`
 * relative to its own module file at runtime, which stays correct as long as it keeps resolving
 * through `lib/core`'s real `node_modules/web-tree-sitter` (true here, since `lib/core` declares
 * it as a direct dependency) rather than being physically relocated into a bundle.
 *
 * Writes atomically (compile to a per-process temp file, then rename) so concurrent test workers
 * compiling at the same time can't observe — or produce — a partially-written file.
 */
async function compileWorkerForDevMode(
  sourcePath: string,
  outPath: string,
): Promise<void> {
  const esbuild = await import("esbuild");
  const tmpPath = `${outPath}.${process.pid}.tmp`;

  await esbuild.build({
    entryPoints: [sourcePath],
    outfile: tmpPath,
    bundle: true,
    format: DevWorkerBuildConfig.FORMAT,
    platform: DevWorkerBuildConfig.PLATFORM,
    target: DevWorkerBuildConfig.TARGET,
    // No createRequire banner needed here (unlike artifacts/cli/tsup.config.ts's build of this
    // same file): ast-worker.ts already declares its own top-level
    // `const require = createRequire(import.meta.url)` for resolveWasmPath()'s
    // require.resolve() calls, which — since esbuild bundles everything into one shared
    // scope — any bundled-in CJS interop code ends up using too.
    external: [DevWorkerBuildConfig.EXTERNAL_TREE_SITTER],
  });

  fs.renameSync(tmpPath, outPath);
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
}

/**
 * Extracted from old Docuvia's ingestion cache interfaces — `AstWorkerPool`'s optional `cache`
 * constructor parameter is the only consumer.
 */
export interface IAsxParseCache {
  get(contentHash: string): AstParseResponse | undefined;
  set(contentHash: string, result: AstParseResponse): void;
  metrics: CacheMetrics;
  clear(): void;
}

export interface IASTWorkerPool {
  initialize(workerCount?: number): Promise<void>;
  parse(request: Omit<AstParseRequest, "taskId">): Promise<AstParseResponse>;
  terminate(): Promise<void>;
}

export class AstWorkerCrashError extends Error {
  constructor(
    public readonly filePath: string | undefined,
    public readonly cause: unknown,
  ) {
    super(
      AstMessages.workerCrashWhileParsing(
        filePath ?? AstMessages.UNKNOWN_FILE,
      ) + (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = AST_WORKER_CRASH_ERROR_NAME;
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
  // through this chain).
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
  private readonly ipcLogRouter: IpcLogRouter;

  constructor(
    private readonly logger: ILogger = createNoopLogger(),
    private readonly taskTimeoutMs: number = 30_000,
    private cache?: IAsxParseCache,
    private readonly workerScriptPathOverride?: string,
  ) {
    // See docs/gitbook/guidelines/playbook-ipc-logging.md — the worker can't hold a live
    // ILogger, so it sends IIpcLogMessages; this pool already has the real per-request logger
    // (injected here, from the Factory's params), so routing is a direct forward.
    this.ipcLogRouter = new IpcLogRouter(this.logger);
  }

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

    worker.on("message", (res: AstParseResponse | IIpcLogMessage) => {
      if (this.ipcLogRouter.handleMessage(res)) return;

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
        // and Node reports that as a non-zero "exit" event even though nothing went wrong.
        // Every still-idle worker at shutdown time would otherwise be misreported as a crash.
        this.logger.debug(AstMessages.WORKER_EXITED_DURING_SHUTDOWN, {
          taskId,
          filePath,
        });
      } else {
        this.logger.error(AstMessages.WORKER_CRASHED_EXITED, {
          taskId,
          filePath,
          hadInFlightTask: Boolean(taskId),
          error:
            err instanceof Error
              ? { message: err.message, name: err.name }
              : err,
        });
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
                ? new Error(
                    AstMessages.taskTimedOutAfterMs(taskId, this.taskTimeoutMs),
                  )
                : err || new Error(AstMessages.WORKER_EXITED_UNEXPECTEDLY),
            ),
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
      if (code !== 0)
        handleError(new Error(AstMessages.workerExitedWithCode(code)));
    });

    this.workers.push(worker);
    this.workerQueue.push(worker);
    this.processQueue();

    return worker;
  }

  async initialize(workerCount: number = 2): Promise<void> {
    if (this.workerScriptPathOverride) {
      // Test-only seam: bypass the dist/ts resolution below entirely so tests can point
      // the pool at a fixture worker script (e.g. one that deterministically crashes).
      this.wPath = this.workerScriptPathOverride;
      this.workerOptions.execArgv = process.execArgv.filter(
        (arg) =>
          !arg.includes(NodeExecArgvFlags.EVAL) &&
          !arg.includes(NodeExecArgvFlags.PRINT),
      );
      if (
        !this.workerOptions.execArgv.some((arg: string) =>
          arg.includes(NodeExecArgvFlags.TSX_LOADER),
        )
      ) {
        this.workerOptions.execArgv.push(
          NodeExecArgvFlags.IMPORT,
          NodeExecArgvFlags.TSX_LOADER,
        );
      }
      for (let i = 0; i < workerCount; i++) {
        await this.enqueueSpawn();
      }
      return;
    }

    // Determine if we are in a dist/ (pre-built) or dev/test (raw source) environment.
    this.wPath = path.resolve(__dirname, "./ast-worker.js");

    if (!fs.existsSync(this.wPath)) {
      const sourcePath = path.resolve(__dirname, "./ast-worker.ts");
      await compileWorkerForDevMode(sourcePath, this.wPath);
    }

    // Either dist/'s own pre-built worker, or the one compileWorkerForDevMode() just produced —
    // both are real, standalone .js, so no loader is ever needed.
    this.workerOptions.execArgv = [];

    for (let i = 0; i < workerCount; i++) {
      await this.enqueueSpawn();
    }
  }

  parse(request: Omit<AstParseRequest, "taskId">): Promise<AstParseResponse> {
    return new Promise((resolve, reject) => {
      // Content hash is only ever needed to key the optional cache -- compute it lazily so
      // callers without a cache configured (the only production wiring today, see
      // register.ts) don't pay a SHA-256 pass over every file's full text for nothing.
      let contentHash: string | undefined;

      // Check cache first with timing instrumentation
      if (this.cache) {
        contentHash = crypto
          .createHash(HASH_ALGO_SHA256)
          .update(request.code)
          .digest(ENCODING_HEX);

        const cacheStartTime = performance.now();
        const cachedResult = this.cache.get(contentHash);
        const cacheLookupTime = performance.now() - cacheStartTime;

        if (cachedResult) {
          this.logger.debug(AstMessages.PARSE_CACHE_HIT, {
            contentHash,
            cacheLookupTimeMs: Number(cacheLookupTime.toFixed(2)),
          });
          resolve(cachedResult);
          return;
        }
      }

      // Queue for worker processing
      const queuedAt = Date.now();
      this.taskQueue.push({
        request,
        resolve: (result: AstParseResponse) => {
          // Cache the result before resolving. contentHash is always set together with
          // this.cache above, in the same parse() call.
          if (this.cache) {
            this.cache.set(contentHash!, result);
            const metrics = this.cache.metrics;
            if (
              metrics.hits + metrics.misses > 0 &&
              (metrics.hits + metrics.misses) % 100 === 0
            ) {
              const hitRate =
                (metrics.hits / (metrics.hits + metrics.misses)) * 100;
              const queueWaitTime = Date.now() - queuedAt;
              this.logger.info(
                AstMessages.CACHE_METRICS_AND_QUEUE_PERFORMANCE,
                {
                  hitRate: Number(hitRate.toFixed(2)),
                  queueWaitTimeMs: queueWaitTime,
                  ...metrics,
                },
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

  // Drains as many task/worker pairs as are currently available, not just one -- a
  // single-shift version left later-queued tasks stranded whenever a worker was pushed
  // into workerQueue (e.g. spawnWorker() after a crash respawn) without a task already
  // waiting to catch it on that same call; nothing else was guaranteed to call this again.
  private processQueue() {
    while (this.taskQueue.length > 0 && this.workerQueue.length > 0) {
      const task = this.taskQueue.shift()!;
      const worker = this.workerQueue.shift()!;

      const taskId = String(++this.taskCounter);
      this.pendingTasks.set(taskId, {
        resolve: task.resolve,
        reject: task.reject,
      });
      this.workerTasks.set(worker, taskId);
      this.taskFilePaths.set(taskId, task.request.filePath);

      const timeout = setTimeout(() => {
        this.taskTimeouts.delete(taskId);
        this.timedOutWorkers.add(worker);
        this.logger.error(AstMessages.TASK_TIMED_OUT_TERMINATING, {
          taskId,
          filePath: this.taskFilePaths.get(taskId),
          taskTimeoutMs: this.taskTimeoutMs,
        });
        // Deliberate termination; the worker's own "exit" handler rejects the pending task,
        // removes it from the pool, and respawns a replacement.
        worker.terminate().catch(() => {});
      }, this.taskTimeoutMs);
      this.taskTimeouts.set(taskId, timeout);

      worker.postMessage({ ...task.request, taskId });
    }
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
