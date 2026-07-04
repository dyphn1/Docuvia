import { Worker } from "worker_threads";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { AstParseRequest, AstParseResponse } from "../workers/ast-worker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface IASTWorkerPool {
  initialize(workerCount?: number): Promise<void>;
  parse(request: Omit<AstParseRequest, "taskId">): Promise<AstParseResponse>;
  terminate(): Promise<void>;
}

export class AstWorkerPool implements IASTWorkerPool {
  private workers: Worker[] = [];
  private workerTasks = new Map<Worker, string>();
  private workerOptions: any = {};
  private wPath: string = "";
  private workerQueue: Worker[] = [];
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

  private spawnWorker() {
    const worker = new Worker(this.wPath, this.workerOptions);

    worker.on("message", (res: AstParseResponse) => {
      this.workerTasks.delete(worker);
      const promiseCallbacks = this.pendingTasks.get(res.taskId);
      if (promiseCallbacks) {
        this.pendingTasks.delete(res.taskId);
        promiseCallbacks.resolve(res);
      }

      this.workerQueue.push(worker);
      this.processQueue();
    });

    const handleError = (err: any) => {
      console.error("[AstWorkerPool] Worker crashed/exited:", err);
      const taskId = this.workerTasks.get(worker);
      if (taskId) {
        const callbacks = this.pendingTasks.get(taskId);
        if (callbacks) {
          callbacks.reject(err || new Error("Worker exited unexpectedly"));
          this.pendingTasks.delete(taskId);
        }
        this.workerTasks.delete(worker);
      }

      // Remove from pool
      this.workers = this.workers.filter((w) => w !== worker);
      this.workerQueue = this.workerQueue.filter((w) => w !== worker);

      // Respawn
      this.spawnWorker();
    };

    worker.on("error", handleError);
    worker.on("exit", (code) => {
      if (code !== 0) handleError(new Error(`Worker exited with code ${code}`));
    });

    this.workers.push(worker);
    this.workerQueue.push(worker);
  }

  async initialize(workerCount: number = 2): Promise<void> {
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
      this.spawnWorker();
    }
  }

  parse(request: Omit<AstParseRequest, "taskId">): Promise<AstParseResponse> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ request, resolve, reject });
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

    worker.postMessage({ ...task.request, taskId });
  }

  async terminate(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.workerQueue = [];
  }
}
