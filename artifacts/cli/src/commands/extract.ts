import { ExtractService, AstWorkerPool } from "@workspace/core";
import process from "process";

export async function extractCommand(targetFile: string) {
  if (!targetFile) {
    console.error("Usage: docuvia extract <file_path>");
    process.exit(1);
  }

  const workspaceRoot = process.cwd();
  const workerPool = new AstWorkerPool();
  await workerPool.initialize(2);

  const extractService = new ExtractService(workspaceRoot, workerPool);
  try {
    const result = await extractService.extractDecisions(targetFile);
    console.log(`Extracted decisions from ${targetFile}:`);
    result.decisions.forEach((decision) => console.log(`- ${decision}`));
  } catch (error: any) {
    console.error("Extraction failed:", error.message);
    await workerPool.terminate();
    process.exit(1);
  }

  await workerPool.terminate();
}
