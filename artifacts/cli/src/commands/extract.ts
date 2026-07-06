import { ExtractService, AstWorkerPool } from "@workspace/core";
import process from "process";

export async function extractCommand(targetFile?: string) {
  const target = targetFile || "";

  const workspaceRoot = process.cwd();
  const workerPool = new AstWorkerPool();
  await workerPool.initialize(2);

  const extractService = new ExtractService(workspaceRoot, workerPool);
  try {
    const result = await extractService.extractDecisions(target);
    console.log(`Extracted decisions from ${target || "workspace root"}:`);
    result.decisions.forEach((decision) => console.log(`- ${decision}`));
  } catch (error: any) {
    console.error("Extraction failed:", error.message);
    await workerPool.terminate();
    process.exit(1);
  }

  await workerPool.terminate();
}
