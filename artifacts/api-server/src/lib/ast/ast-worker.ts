import { workerData, parentPort } from "node:worker_threads";
import { processAstFile, ParseResult } from "./ast-ingestion-task.js";
export type { ParseResult };

// Keep ast-worker.ts as just the entry point for the Node.js worker_threads
// (i.e. parsing workerData, catching top-level process errors, and instantiating/calling ast-ingestion-task)

if (workerData && parentPort) {
  try {
    // Parsing workerData
    const filePath = typeof workerData === "string" ? workerData : workerData.filePath;
    
    if (!filePath || typeof filePath !== "string") {
      throw new Error("Invalid workerData: filePath must be a string");
    }

    processAstFile(filePath)
      .then((result) => parentPort?.postMessage(result))
      .catch((err) => {
        console.error("Worker process execution error:", err);
        parentPort?.postMessage({ status: "error", reason: err.message });
      });
  } catch (err: any) {
    console.error("Worker process initialization error:", err);
    parentPort.postMessage({ status: "error", reason: err.message });
  }
}

// In Piscina, the default export is the worker function
export default async function parseAst(filePath: string): Promise<ParseResult> {
  try {
    return await processAstFile(filePath);
  } catch (err: any) {
    console.error("Worker process error:", err);
    return { status: "error", reason: err.message };
  }
}
