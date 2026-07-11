import * as fs from "fs/promises";
import * as path from "path";
import process from "process";
import { BasePlatform } from "./base.platform.js";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import {
  CLAUDE_HOOKS_DIR,
  DOCUVIA_HOOK_JS,
  HOOKS_JSON,
  DOCUVIA_HOOK_JS_FILENAME,
  HOOKS_CONFIG_FILENAME,
  CLAUDE_DESKTOP_CONFIG_FILENAME,
  MCP_SERVER_ALIAS,
  PLATFORM_NAME_CLAUDE,
  NPX_COMMAND,
  NPX_YES_FLAG,
  DOCUVIA_MCP_LAUNCH_ARGS,
  DOCUVIA_WORKSPACE_ROOT_ENV_VAR,
} from "../constants/init-templates.js";
import { UTF8_ENCODING } from "@workspace/core";
import { writeOrAppend } from "../utils/fs-utils.js";

function resolveClaudeDesktopConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || "", PLATFORM_NAME_CLAUDE);
  }
  if (process.platform === "darwin") {
    return path.join(
      process.env.HOME || "",
      "Library",
      "Application Support",
      PLATFORM_NAME_CLAUDE
    );
  }
  return path.join(process.env.HOME || "", ".config", PLATFORM_NAME_CLAUDE);
}

export class ClaudePlatform extends BasePlatform {
  readonly name = PLATFORM_NAME_CLAUDE;

  async configure(cwd: string, allowGlobalMcpConfig = false): Promise<void> {
    await this.configureHooks(cwd);
    await this.maybeConfigureMcpServer(cwd, allowGlobalMcpConfig);
  }

  /**
   * `configureMcpServer` writes a machine-global config file (shared across every project on
   * this machine, not just `cwd`). Only proceed when the caller explicitly opted in via
   * `--global`, or — when running interactively — after an explicit confirm defaulting to "No".
   * In non-TTY runs without `--global`, skip and tell the user how to enable it.
   */
  private async maybeConfigureMcpServer(cwd: string, allowGlobalMcpConfig: boolean): Promise<void> {
    const claudeConfigDir = resolveClaudeDesktopConfigDir();
    if (!claudeConfigDir) return;
    const claudeMcpPath = path.join(claudeConfigDir, CLAUDE_DESKTOP_CONFIG_FILENAME);

    if (allowGlobalMcpConfig) {
      await this.configureMcpServer(cwd);
      return;
    }

    if (process.stdin.isTTY) {
      const proceed = await ui.askConfirm(
        `${UI_MESSAGES.INIT_GLOBAL_MCP_CONFIRM} (${claudeMcpPath})`,
        false
      );
      if (proceed) {
        await this.configureMcpServer(cwd);
        return;
      }
    }

    ui.info(`${UI_MESSAGES.INIT_GLOBAL_MCP_SKIPPED} (${claudeMcpPath})`);
  }

  private async configureHooks(cwd: string): Promise<void> {
    const claudeHooksPath = path.join(cwd, CLAUDE_HOOKS_DIR);
    await fs.mkdir(claudeHooksPath, { recursive: true });
    await fs.writeFile(path.join(claudeHooksPath, DOCUVIA_HOOK_JS_FILENAME), DOCUVIA_HOOK_JS, {
      mode: 0o755,
    });

    let claudeHooksConfig = HOOKS_JSON.replace(/\${HOOKS_DIR}/g, "${CLAUDE_PLUGIN_ROOT}/hooks");
    await writeOrAppend(
      path.join(claudeHooksPath, HOOKS_CONFIG_FILENAME),
      claudeHooksConfig,
      DOCUVIA_HOOK_JS_FILENAME
    );
  }

  private async configureMcpServer(cwd: string): Promise<void> {
    const claudeConfigDir = resolveClaudeDesktopConfigDir();
    if (!claudeConfigDir) return;

    const claudeMcpPath = path.join(claudeConfigDir, CLAUDE_DESKTOP_CONFIG_FILENAME);
    try {
      let claudeMcp: any = { mcpServers: {} };
      try {
        const existing = await fs.readFile(claudeMcpPath, UTF8_ENCODING);
        claudeMcp = JSON.parse(existing);
      } catch {
        await fs.mkdir(path.dirname(claudeMcpPath), { recursive: true });
      }
      claudeMcp.mcpServers = claudeMcp.mcpServers || {};

      // For global Claude config, we must provide the absolute path to the project to run npx properly
      claudeMcp.mcpServers[MCP_SERVER_ALIAS] = {
        command: NPX_COMMAND,
        args: [NPX_YES_FLAG, ...DOCUVIA_MCP_LAUNCH_ARGS],
        env: {
          [DOCUVIA_WORKSPACE_ROOT_ENV_VAR]: cwd,
        },
      };

      await fs.writeFile(claudeMcpPath, JSON.stringify(claudeMcp, null, 2));
      ui.success(UI_MESSAGES.INIT_HOOKS_REGISTERED_MCP + claudeMcpPath);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      ui.warn(UI_MESSAGES.INIT_HOOKS_FAIL_CLAUDE_MCP + errorMessage);
    }
  }
}
