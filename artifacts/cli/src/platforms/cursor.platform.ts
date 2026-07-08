import * as fs from "fs/promises";
import * as path from "path";
import { BasePlatform } from "./base.platform.js";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import { CURSOR_HOOKS_DIR, DOCUVIA_HOOK_JS, HOOKS_JSON } from "../constants/init-templates.js";
import { writeOrAppend } from "../utils/fs-utils.js";

export class CursorPlatform extends BasePlatform {
  readonly name = "Cursor";

  async configure(cwd: string): Promise<void> {
    // 1. Setup Executable Hooks
    const cursorHooksPath = path.join(cwd, CURSOR_HOOKS_DIR);
    await fs.mkdir(cursorHooksPath, { recursive: true });
    await fs.writeFile(path.join(cursorHooksPath, "docuvia-hook.cjs"), DOCUVIA_HOOK_JS, {
      mode: 0o755,
    });

    let cursorHooksConfig = HOOKS_JSON.replace(
      /\${HOOKS_DIR}/g,
      "${CURSOR_PLUGIN_ROOT}/hooks"
    ).replace(".js", ".cjs");
    await writeOrAppend(
      path.join(cursorHooksPath, "hooks.json"),
      cursorHooksConfig,
      "docuvia-hook.cjs"
    );

    // 2. Setup MCP Server
    const cursorMcpPath = path.join(cwd, ".cursor", "mcp.json");
    try {
      let cursorMcp: any = { mcpServers: {} };
      try {
        const existing = await fs.readFile(cursorMcpPath, "utf8");
        cursorMcp = JSON.parse(existing);
      } catch {
        await fs.mkdir(path.dirname(cursorMcpPath), { recursive: true });
      }
      cursorMcp.mcpServers = cursorMcp.mcpServers || {};
      cursorMcp.mcpServers["docuvia-local"] = {
        command: "npx",
        args: ["--no-install", "docuvia", "mcp"],
      };
      await fs.writeFile(cursorMcpPath, JSON.stringify(cursorMcp, null, 2));
      ui.success(UI_MESSAGES.INIT_HOOKS_REGISTERED_MCP + cursorMcpPath);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      ui.warn(UI_MESSAGES.INIT_HOOKS_FAIL_CURSOR_MCP + errorMessage);
    }
  }
}
