import process from "process";
import { ui } from "../ui/wizard.js";
import { InitService, DI_TOKENS, DI_KEYS } from "@workspace/core";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { CursorPlatform, ClaudePlatform, GenericMarkdownPlatform } from "../platforms/index.js";
import { resolveConfiguredService } from "../utils/resolve-service.js";

async function runDatabaseInit(cwd: string): Promise<void> {
  const spinner = ui.spinner(UI_MESSAGES.INIT_START).start();

  try {
    const initService = resolveConfiguredService<InitService>(DI_TOKENS.InitService, {
      [DI_KEYS.WORKSPACE_ROOT]: cwd,
      [DI_KEYS.LOG_CALLBACK]: (msg: string) => {
        spinner.text = msg;
      },
    });

    const result = await initService.init();
    spinner.succeed(result.message);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    spinner.fail(UI_MESSAGES.INIT_FAILED + errorMessage);
    process.exit(1);
  }
}

async function configureAgentIntegrations(cwd: string): Promise<void> {
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
      ui.info(UI_MESSAGES.INIT_HOOKS_NONE_SELECTED);
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

  await runDatabaseInit(cwd);
  await configureAgentIntegrations(cwd);
}
