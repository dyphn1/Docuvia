import { InitService } from "@workspace/core";
import { initAgent } from "./init-agent.js";
import process from "process";

export async function initCommand() {
  const workspaceRoot = process.cwd();
  const initService = new InitService(workspaceRoot);
  try {
    const result = await initService.init();
    console.log(result.message);

    // Wire up the agent init which includes the post-commit hook
    await initAgent(workspaceRoot);
  } catch (error: any) {
    console.error("Initialization failed:", error.message);
    process.exit(1);
  }
}
