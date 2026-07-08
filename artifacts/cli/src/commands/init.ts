import * as fs from "fs/promises";
import * as path from "path";
import process from "process";
import { ui } from "../ui/wizard.js";
import { InitService } from "@workspace/core";

const CLAUDE_HOOKS_DIR = ".claude/hooks";
const CURSOR_HOOKS_DIR = ".cursor/hooks";
const GITHUB_DIR = ".github";

const DOCUVIA_HOOK_JS = `#!/usr/bin/env node
/**
 * Docuvia Agent Hook
 * Intercepts AI searches and augments with high-density AST context from local SQLite.
 */
const { execSync } = require('child_process');

function readInput() {
  try {
    const data = require('fs').readFileSync(0, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

const input = readInput();
// Use the query arguments as the target to retrieve context
const target = input.args ? input.args.query || input.args.pattern : null;

if (target) {
  try {
    // Call the local Docuvia CLI to retrieve exact L2/L3 structural context
    const context = execSync(\`npx --no-install docuvia query "\${target}" --local --format=prompt\`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (context && context.trim().length > 0) {
      console.log("=== Docuvia Context injected ===");
      console.log(context);
      console.log("================================");
    }
  } catch (e: unknown) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("[Docuvia Pre-Command] Failed to retrieve context: " + errorMsg);
  }
}
`;

const HOOKS_JSON = JSON.stringify(
  {
    PreToolUse: [
      {
        hooks: [
          {
            command: "node ${HOOKS_DIR}/docuvia-hook.js",
            statusMessage: "Enriching with Docuvia architectural context...",
            timeout: 5,
            type: "command",
          },
        ],
        matcher: "Grep|Glob|Bash|Read",
      },
    ],
  },
  null,
  2
);

const AGENT_INSTRUCTIONS = `
<!-- docuvia:start -->
# Docuvia — Codebase Knowledge Evolver

This project uses Docuvia to manage architectural context and prevent blast-radius regressions.
Before you explore the codebase (using Grep/Glob/Read) or make structural changes, you MUST query the local knowledge graph:

Run: \`npx --no-install docuvia query "<concept_or_file>" --local --format=prompt\`

Use the results from this command to understand architectural boundaries, historical decisions, and potential blast radius before modifying code.
<!-- docuvia:end -->
`;

async function writeOrAppend(filePath: string, content: string, marker: string) {
  try {
    const existing = await fs.readFile(filePath, "utf8");
    if (!existing.includes(marker)) {
      await fs.appendFile(filePath, `\n${content}`);
      ui.success(`Appended instructions to: ${filePath}`);
    } else {
      ui.info(`Instructions already exist in: ${filePath}`);
    }
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    ui.success(`Created: ${filePath}`);
  }
}

async function registerMcpServer(cwd: string) {
  ui.info("Configuring MCP Servers...");

  const mcpConfig = {
    command: "npx",
    args: ["--no-install", "docuvia", "mcp"],
  };

  // Cursor Configuration
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
    cursorMcp.mcpServers["docuvia-local"] = mcpConfig;
    await fs.writeFile(cursorMcpPath, JSON.stringify(cursorMcp, null, 2));
    ui.success(`Registered MCP server in: ${cursorMcpPath}`);
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    ui.warn(`Could not configure Cursor MCP: ${errorMessage}`);
  }

  // Claude Desktop Configuration (Global)
  let claudeConfigDir = "";
  if (process.platform === "win32") {
    claudeConfigDir = path.join(process.env.APPDATA || "", "Claude");
  } else if (process.platform === "darwin") {
    claudeConfigDir = path.join(process.env.HOME || "", "Library", "Application Support", "Claude");
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
      ui.success(`Registered MCP server in: ${claudeMcpPath}`);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      ui.warn(`Could not configure Claude Desktop MCP: ${errorMessage}`);
    }
  }
}

export async function initCommand(cwd: string = process.cwd()) {
  ui.header("Initialize Docuvia");

  // Optional interactive confirmation if TTY
  if (process.stdin.isTTY) {
    const proceed = await ui.askConfirm("Initialize Docuvia in this workspace?", true);
    if (!proceed) {
      ui.warn("Initialization aborted.");
      process.exit(0);
    }
  }

  const spinner = ui.spinner("Starting initialization...").start();

  const initService = new InitService(cwd, (msg) => {
    spinner.text = msg;
  });

  try {
    const result = await initService.init();
    spinner.succeed(result.message);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    spinner.fail(`Initialization failed: ${errorMessage}`);
    process.exit(1);
  }

  ui.info("Initializing AI Agent integrations for Docuvia...");

  try {
    // 1. Setup Executable Hooks (Claude Code, Cursor)
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

    // 2. Setup Static Rules/Instructions (Copilot, Windsurf, Zed, Continue, Generic)

    // GitHub Copilot
    await writeOrAppend(
      path.join(cwd, GITHUB_DIR, "copilot-instructions.md"),
      AGENT_INSTRUCTIONS,
      "docuvia:start"
    );

    // Claude Desktop / Generic Markdown
    await writeOrAppend(path.join(cwd, "CLAUDE.md"), AGENT_INSTRUCTIONS, "docuvia:start");

    // Windsurf
    await writeOrAppend(path.join(cwd, ".windsurfrules"), AGENT_INSTRUCTIONS, "docuvia:start");

    // Cursor Rules (Fallback for non-hook Cursor modes)
    await writeOrAppend(path.join(cwd, ".cursorrules"), AGENT_INSTRUCTIONS, "docuvia:start");

    // Standard LLM Crawler text
    await writeOrAppend(path.join(cwd, "llms.txt"), AGENT_INSTRUCTIONS, "docuvia:start");

    await registerMcpServer(cwd);

    ui.success("Docuvia Agent Integrations successfully installed!");
    ui.info(
      "Supported platforms: Claude Code, Cursor, GitHub Copilot, Windsurf, Zed, Continue, OpenCode, Gemini CLI."
    );
  } catch (error) {
    ui.error(`Failed to initialize agent integrations: ${error}`);
    process.exit(1);
  }
}
