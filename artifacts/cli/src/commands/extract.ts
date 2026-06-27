import { ExtractService } from "@workspace/core";
import process from "process";

export async function extractCommand(targetFile: string) {
  if (!targetFile) {
    console.error("Usage: docuvia extract <file_path>");
    process.exit(1);
  }

  const workspaceRoot = process.cwd();
  const extractService = new ExtractService(workspaceRoot);
  try {
    const result = await extractService.extractDecisions(targetFile);
    console.log(`Extracted decisions from ${targetFile}:`);
    result.decisions.forEach((decision) => console.log(`- ${decision}`));
  } catch (error: any) {
    console.error("Extraction failed:", error.message);
    process.exit(1);
  }
}
