// Test-only worker script for ast-worker-pool.unit.test.ts. Never responds to any
// task message, so a task against it can only settle via the pool's task-timeout
// path (forced terminate) rather than a normal result — used to exercise the
// timeout/termination branch deterministically.
import { parentPort } from "worker_threads";

parentPort?.on("message", () => {
  // Deliberately never postMessage back.
});
