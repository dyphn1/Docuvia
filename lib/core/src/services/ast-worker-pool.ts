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

  async initialize(workerCount: number = 2): Promise<void> {
    // Determine if we are in .ts environment (tsx) or .js environment (dist)
    let isTs = false;
    let wPath = path.resolve(__dirname, "../workers/ast-worker.js");

    if (!fs.existsSync(wPath)) {
      wPath = path.resolve(__dirname, "../workers/ast-worker.ts");
      isTs = true;
    }

    const workerOptions: any = {};
    if (isTs) {
      // Inherit the exact tsx loader from the parent process, filtering out any script-specific args
      workerOptions.execArgv = process.execArgv.filter(
        (arg) => !arg.includes("--eval") && !arg.includes("--print")
      );
    } else {
      // If running from dist/ast-worker.js, we don't need any loaders.
      workerOptions.execArgv = [];
    }

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(wPath, workerOptions);

      worker.on("message", (res: AstParseResponse) => {
        const promiseCallbacks = this.pendingTasks.get(res.taskId);
        if (promiseCallbacks) {
          this.pendingTasks.delete(res.taskId);
          promiseCallbacks.resolve(res);
        }

        this.workerQueue.push(worker);
        this.processQueue();
      });

      worker.on("error", (err) => {
        console.error("[AstWorkerPool] Worker error:", err);
      });

      this.workers.push(worker);
      this.workerQueue.push(worker);
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

    worker.postMessage({ ...task.request, taskId });
  }

  async terminate(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.workerQueue = [];
  }
}
