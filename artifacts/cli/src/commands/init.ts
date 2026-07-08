import * as fs from "fs/promises";
import * as path from "path";
import process from "process";
import { ui } from "../ui/wizard.js";
import { InitService, DI_TOKENS, DI_KEYS, container } from "@workspace/core";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { CursorPlatform, ClaudePlatform, GenericMarkdownPlatform } from "../platforms/index.js";

export async function initCommand(cwd: string = process.cwd()) {
  ui.header(UI_MESSAGES.INIT_HEADER);

  // Optional interactive confirmation if TTY
  if (process.stdin.isTTY) {
    const proceed = await ui.askConfirm(UI_MESSAGES.INIT_CONFIRM, true);
    if (!proceed) {
      ui.warn(UI_MESSAGES.INIT_ABORTED);
      process.exit(0);
    }
  }

  const spinner = ui.spinner(UI_MESSAGES.INIT_START).start();

  try {
    const initService = container.resolve<InitService>(DI_TOKENS.InitService);
    // Bind constructor dependencies manually since we didn't fully restructure InitService yet
    (initService as any)[DI_KEYS.WORKSPACE_ROOT] = cwd;
    (initService as any)[DI_KEYS.LOG_CALLBACK] = (msg: string) => {
      spinner.text = msg;
    };

    const result = await initService.init();
    spinner.succeed(result.message);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    spinner.fail(UI_MESSAGES.INIT_FAILED + errorMessage);
    process.exit(1);
  }

  ui.info(UI_MESSAGES.INIT_AGENT_HOOKS);

  try {
    const availablePlatforms = [
      new CursorPlatform(),
      new ClaudePlatform(),
      new GenericMarkdownPlatform(),
    ];

    let selectedPlatforms = availablePlatforms;

    if (process.stdin.isTTY) {
      const choices = availablePlatforms.map((p) => ({
        name: p.name,
        value: p.name,
        checked: true,
      }));

      const selectedNames = await ui.askCheckbox(UI_MESSAGES.INIT_HOOKS_SELECT, choices);
      selectedPlatforms = availablePlatforms.filter((p) => selectedNames.includes(p.name));
    }

    if (selectedPlatforms.length === 0) {
      ui.info("No platforms selected. Skipping agent integrations.");
      return;
    }

    for (const platform of selectedPlatforms) {
      await platform.configure(cwd);
    }

    ui.success(UI_MESSAGES.INIT_HOOKS_SUCCESS);
    ui.info(UI_MESSAGES.INIT_HOOKS_SUPPORTED);
  } catch (error) {
    ui.error(UI_MESSAGES.INIT_HOOKS_FAIL + error);
    process.exit(1);
  }
}
