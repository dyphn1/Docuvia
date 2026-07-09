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
} from "../constants/init-templates.js";
import { writeOrAppend } from "../utils/fs-utils.js";

function resolveClaudeDesktopConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || "", "Claude");
  }
  if (process.platform === "darwin") {
    return path.join(process.env.HOME || "", "Library", "Application Support", "Claude");
  }
  return path.join(process.env.HOME || "", ".config", "Claude");
}

export class ClaudePlatform extends BasePlatform {
  readonly name = "Claude";

  async configure(cwd: string): Promise<void> {
    await this.configureHooks(cwd);
    await this.configureMcpServer(cwd);
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
        const existing = await fs.readFile(claudeMcpPath, "utf8");
        claudeMcp = JSON.parse(existing);
      } catch {
        await fs.mkdir(path.dirname(claudeMcpPath), { recursive: true });
      }
      claudeMcp.mcpServers = claudeMcp.mcpServers || {};

      // For global Claude config, we must provide the absolute path to the project to run npx properly
      claudeMcp.mcpServers[MCP_SERVER_ALIAS] = {
        command: "npx",
        args: ["-y", "docuvia", "mcp"],
        env: {
          DOCUVIA_WORKSPACE_ROOT: cwd,
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
