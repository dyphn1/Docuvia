import * as fs from "fs/promises";
import * as path from "path";
import { BasePlatform } from "./base.platform.js";
import { ui } from "../ui/wizard.js";
import { UI_MESSAGES } from "../constants/ui-messages.js";
import {
  CURSOR_HOOKS_DIR,
  CURSOR_PLUGIN_HOOKS_DIR,
  DOCUVIA_HOOK_JS,
  HOOKS_JSON,
  DOCUVIA_HOOK_CJS_FILENAME,
  HOOKS_CONFIG_FILENAME,
  CURSOR_MCP_CONFIG_PATH,
  MCP_SERVER_ALIAS,
  PLATFORM_NAME_CURSOR,
  PLATFORM_SLUG_CURSOR,
  NPX_COMMAND,
  NPX_NO_INSTALL_FLAG,
  DOCUVIA_MCP_LAUNCH_ARGS,
} from "../constants/init-templates.js";
import { UTF8_ENCODING } from "@workspace/contracts";
import { writeOrAppend } from "../utils/fs-utils.js";

const HOOK_JS_EXTENSION = ".js";
const HOOK_CJS_EXTENSION = ".cjs";

export class CursorPlatform extends BasePlatform {
  readonly name = PLATFORM_NAME_CURSOR;
  readonly slug = PLATFORM_SLUG_CURSOR;

  async installHooks(cwd: string): Promise<void> {
    await this.configureHooks(cwd);
    await this.configureMcpServer(cwd);
  }

  private async configureHooks(cwd: string): Promise<void> {
    const cursorHooksPath = path.join(cwd, CURSOR_HOOKS_DIR);
    await fs.mkdir(cursorHooksPath, { recursive: true });
    await fs.writeFile(
      path.join(cursorHooksPath, DOCUVIA_HOOK_CJS_FILENAME),
      DOCUVIA_HOOK_JS,
      {
        mode: 0o755,
      },
    );

    let cursorHooksConfig = HOOKS_JSON.replace(
      /\${HOOKS_DIR}/g,
      CURSOR_PLUGIN_HOOKS_DIR,
    ).replace(HOOK_JS_EXTENSION, HOOK_CJS_EXTENSION);
    await writeOrAppend(
      path.join(cursorHooksPath, HOOKS_CONFIG_FILENAME),
      cursorHooksConfig,
      DOCUVIA_HOOK_CJS_FILENAME,
    );
  }

  private async configureMcpServer(cwd: string): Promise<void> {
    const cursorMcpPath = path.join(cwd, CURSOR_MCP_CONFIG_PATH);
    try {
      let cursorMcp: any = { mcpServers: {} };
      try {
        const existing = await fs.readFile(cursorMcpPath, UTF8_ENCODING);
        cursorMcp = JSON.parse(existing);
      } catch {
        await fs.mkdir(path.dirname(cursorMcpPath), { recursive: true });
      }
      cursorMcp.mcpServers = cursorMcp.mcpServers || {};
      cursorMcp.mcpServers[MCP_SERVER_ALIAS] = {
        command: NPX_COMMAND,
        args: [NPX_NO_INSTALL_FLAG, ...DOCUVIA_MCP_LAUNCH_ARGS],
      };
      await fs.writeFile(cursorMcpPath, JSON.stringify(cursorMcp, null, 2));
      ui.success(UI_MESSAGES.INIT_HOOKS_REGISTERED_MCP + cursorMcpPath);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      ui.warn(UI_MESSAGES.INIT_HOOKS_FAIL_CURSOR_MCP + errorMessage);
    }
  }

  async uninstallHooks(cwd: string): Promise<void> {
    const cursorHooksPath = path.join(cwd, CURSOR_HOOKS_DIR);
    try {
      await fs.unlink(path.join(cursorHooksPath, DOCUVIA_HOOK_CJS_FILENAME));
      ui.success(
        `${UI_MESSAGES.UNINSTALL_REMOVED_FILE_PREFIX}${DOCUVIA_HOOK_CJS_FILENAME}`,
      );
    } catch {}

    const { removeBlock } = await import("../utils/fs-utils.js");
    const {
      CURSOR_RULES_FILENAME,
      AGENT_INSTRUCTIONS_MARKER,
      AGENT_INSTRUCTIONS_END_MARKER,
    } = await import("../constants/init-templates.js");
    const cursorRulesPath = path.join(cwd, CURSOR_RULES_FILENAME);
    await removeBlock(
      cursorRulesPath,
      `<!-- ${AGENT_INSTRUCTIONS_MARKER} -->`,
      `<!-- ${AGENT_INSTRUCTIONS_END_MARKER} -->`,
    );

    const hooksJsonPath = path.join(cursorHooksPath, HOOKS_CONFIG_FILENAME);
    let removedHookJson = false;
    try {
      const content = await fs.readFile(hooksJsonPath, UTF8_ENCODING);
      if (
        content.trim() ===
        HOOKS_JSON.replace(/\$\{HOOKS_DIR\}/g, CURSOR_PLUGIN_HOOKS_DIR)
          .replace(HOOK_JS_EXTENSION, HOOK_CJS_EXTENSION)
          .trim()
      ) {
        await fs.unlink(hooksJsonPath);
        removedHookJson = true;
      }
    } catch {}
    if (removedHookJson) {
      try {
        await fs.rmdir(cursorHooksPath);
      } catch {}
    }

    const cursorMcpPath = path.join(cwd, CURSOR_MCP_CONFIG_PATH);
    try {
      const existing = await fs.readFile(cursorMcpPath, UTF8_ENCODING);
      const cursorMcp = JSON.parse(existing);
      if (cursorMcp?.mcpServers && cursorMcp.mcpServers[MCP_SERVER_ALIAS]) {
        delete cursorMcp.mcpServers[MCP_SERVER_ALIAS];
        await fs.writeFile(cursorMcpPath, JSON.stringify(cursorMcp, null, 2));
        ui.success(
          `${UI_MESSAGES.UNINSTALL_REMOVED_MCP_SERVER_PREFIX}${cursorMcpPath}`,
        );
      }
    } catch {}
  }
}
