import { CleanService } from "@workspace/core";
import process from "process";

export async function cleanCommand() {
  const workspaceRoot = process.cwd();
  const cleanService = new CleanService(workspaceRoot);
  try {
    const result = await cleanService.clean();
    if (result.deleted) {
      console.log("Cleaned .docuvia/local.db database.");
    } else {
      console.log("No local database found to clean.");
    }
  } catch (error: any) {
    console.error("Clean failed:", error.message);
    process.exit(1);
  }
}
