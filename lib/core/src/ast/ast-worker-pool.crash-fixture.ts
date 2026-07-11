// Test-only worker script for ast-worker-pool.unit.test.ts. Deterministically crashes
// (process.exit(1), no catch/reject) when it receives a task for the sentinel file path
// below, and otherwise responds success immediately — used to reproduce a mid-batch
// worker crash without depending on real tree-sitter/parser internals.
import { parentPort } from "worker_threads";

export const CRASH_SENTINEL_FILE_PATH = "the-crashing-file.ts";

parentPort?.on("message", (request: { taskId: string; filePath: string }) => {
  if (request.filePath === CRASH_SENTINEL_FILE_PATH) {
    process.exit(1);
  }

  parentPort?.postMessage({
    taskId: request.taskId,
    success: true,
    data: { imports: [], exports: [], functions: [], classes: [], calls: [] },
  });
});
