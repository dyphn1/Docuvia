import * as fs from "fs/promises";
import * as path from "path";
import process from "process";
import { BasePlatform } from "./base.platform.js";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { CLAUDE_HOOKS_DIR, DOCUVIA_HOOK_JS, HOOKS_JSON } from "../constants/init-templates.js";
import { writeOrAppend } from "../utils/fs-utils.js";

export class ClaudePlatform extends BasePlatform {
  readonly name = "Claude";

  async configure(cwd: string): Promise<void> {
    // 1. Setup Executable Hooks
    const claudeHooksPath = path.join(cwd, CLAUDE_HOOKS_DIR);
    await fs.mkdir(claudeHooksPath, { recursive: true });
    await fs.writeFile(path.join(claudeHooksPath, "docuvia-hook.js"), DOCUVIA_HOOK_JS, {
      mode: 0o755,
    });

    let claudeHooksConfig = HOOKS_JSON.replace(/\${HOOKS_DIR}/g, "${CLAUDE_PLUGIN_ROOT}/hooks");
    await writeOrAppend(
      path.join(claudeHooksPath, "hooks.json"),
      claudeHooksConfig,
      "docuvia-hook.js"
    );

    // 2. Setup MCP Server (Global)
    let claudeConfigDir = "";
    if (process.platform === "win32") {
      claudeConfigDir = path.join(process.env.APPDATA || "", "Claude");
    } else if (process.platform === "darwin") {
      claudeConfigDir = path.join(
        process.env.HOME || "",
        "Library",
        "Application Support",
        "Claude"
      );
    } else {
      claudeConfigDir = path.join(process.env.HOME || "", ".config", "Claude");
    }

    if (claudeConfigDir) {
      const claudeMcpPath = path.join(claudeConfigDir, "claude_desktop_config.json");
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
        claudeMcp.mcpServers["docuvia-local"] = {
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
}
