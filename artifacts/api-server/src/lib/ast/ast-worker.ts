import { AST_STATUS } from "@workspace/core";
import { workerData, parentPort } from "node:worker_threads";
import { processAstFile, ParseResult } from "./ast-ingestion-task.js";
import { AST_INGESTION_DEFAULTS } from "../../constants/index.js";
export type { ParseResult };

const MSG_INVALID_WORKER_DATA = "Invalid workerData: filePath must be a string";
const MSG_WORKER_EXEC_ERROR = "Worker process execution error:";
const MSG_WORKER_INIT_ERROR = "Worker process initialization error:";
const MSG_WORKER_ERROR = "Worker process error:";

// Keep ast-worker.ts as just the entry point for the Node.js worker_threads
// (i.e. parsing workerData, catching top-level process errors, and instantiating/calling ast-ingestion-task)

/**
 * Parses and processes a file path. Returns the ParseResult.
 */
async function runIngestion(filePath: string): Promise<ParseResult> {
  try {
    return await processAstFile(filePath);
  } catch (err: any) {
    return { status: AST_STATUS.ERROR, reason: err.message || String(err) };
  }
}

if (workerData && parentPort) {
  try {
    // Parsing workerData
    const filePath = typeof workerData === "string" ? workerData : workerData.filePath;

    if (!filePath || typeof filePath !== "string") {
      throw new Error(MSG_INVALID_WORKER_DATA);
    }

    runIngestion(filePath)
      .then((result) => parentPort?.postMessage(result))
      .catch((err) => {
        console.error(MSG_WORKER_EXEC_ERROR, err);
        parentPort?.postMessage({ status: AST_STATUS.ERROR, reason: err.message });
      });
  } catch (err: any) {
    console.error(MSG_WORKER_INIT_ERROR, err);
    parentPort.postMessage({ status: AST_STATUS.ERROR, reason: err.message });
  }
}

// In Piscina, the default export is the worker function
export default async function parseAst(filePath: string): Promise<ParseResult> {
  const result = await runIngestion(filePath);
  if (result.status === AST_STATUS.ERROR) {
    console.error(MSG_WORKER_ERROR, result.reason);
  }
  return result;
}
