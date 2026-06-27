import { InitService } from "@workspace/core";
import process from "process";

export async function initCommand() {
  const workspaceRoot = process.cwd();
  const initService = new InitService(workspaceRoot);
  try {
    const result = await initService.init();
    console.log(result.message);
  } catch (error: any) {
    console.error("Initialization failed:", error.message);
    process.exit(1);
  }
}
