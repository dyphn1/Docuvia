import { InitService } from "@workspace/core";
import { initAgent } from "./init-agent.js";
import process from "process";
import { ui } from "../ui/wizard.js";

export async function initCommand() {
  ui.header("Initialize Docuvia");

  // Optional interactive confirmation if TTY
  if (process.stdin.isTTY) {
    const proceed = await ui.askConfirm("Initialize Docuvia in this workspace?", true);
    if (!proceed) {
      ui.warn("Initialization aborted.");
      process.exit(0);
    }
  }

  const workspaceRoot = process.cwd();

  const spinner = ui.spinner("Starting initialization...").start();

  const initService = new InitService(workspaceRoot, (msg) => {
    spinner.text = msg;
  });

  try {
    const result = await initService.init();
    spinner.succeed(result.message);

    // The initAgent script has its own internal console logs currently.
    // For now, let it run as normal. (In a future step, it should also take a callback).
    await initAgent(workspaceRoot);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    spinner.fail(`Initialization failed: ${errorMessage}`);
    process.exit(1);
  }
}
