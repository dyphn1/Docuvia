import * as fs from "fs/promises";
import * as path from "path";

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
  } catch (e) {
    // Fail silently
  }
}
`;

const HOOKS_JSON = JSON.stringify({
  PreToolUse: [
    {
      hooks: [
        {
          command: "node ${HOOKS_DIR}/docuvia-hook.js",
          statusMessage: "Enriching with Docuvia architectural context...",
          timeout: 5,
          type: "command"
        }
      ],
      matcher: "Grep|Glob|Bash|Read"
    }
  ]
}, null, 2);

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
      console.log(`✅ Appended instructions to: ${filePath}`);
    } else {
      console.log(`⏭️ Instructions already exist in: ${filePath}`);
    }
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    console.log(`✅ Created: ${filePath}`);
  }
}



async function registerMcpServer(cwd: string) {
  console.log("\nConfiguring MCP Servers...");
  
  const mcpConfig = {
    command: "npx",
    args: ["--no-install", "docuvia", "mcp"]
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
    console.log(`✅ Registered MCP server in: ${cursorMcpPath}`);
  } catch (e: any) {
    console.warn(`⚠️ Could not configure Cursor MCP: ${e.message}`);
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
          DOCUVIA_WORKSPACE_ROOT: cwd
        }
      };
      
      await fs.writeFile(claudeMcpPath, JSON.stringify(claudeMcp, null, 2));
      console.log(`✅ Registered MCP server in: ${claudeMcpPath}`);
    } catch (e: any) {
      console.warn(`⚠️ Could not configure Claude Desktop MCP: ${e.message}`);
    }
  }
}

export async function initAgent(cwd: string = process.cwd()) {
  console.log("Initializing AI Agent integrations for Docuvia...\n");

  try {
    // 1. Setup Executable Hooks (Claude Code, Cursor)
    const claudeHooksPath = path.join(cwd, CLAUDE_HOOKS_DIR);
    await fs.mkdir(claudeHooksPath, { recursive: true });
    await fs.writeFile(path.join(claudeHooksPath, "docuvia-hook.js"), DOCUVIA_HOOK_JS, { mode: 0o755 });
    
    let claudeHooksConfig = HOOKS_JSON.replace(/\${HOOKS_DIR}/g, "${CLAUDE_PLUGIN_ROOT}/hooks");
    await writeOrAppend(path.join(claudeHooksPath, "hooks.json"), claudeHooksConfig, "docuvia-hook.js");

    const cursorHooksPath = path.join(cwd, CURSOR_HOOKS_DIR);
    await fs.mkdir(cursorHooksPath, { recursive: true });
    await fs.writeFile(path.join(cursorHooksPath, "docuvia-hook.cjs"), DOCUVIA_HOOK_JS, { mode: 0o755 });
    
    let cursorHooksConfig = HOOKS_JSON.replace(/\${HOOKS_DIR}/g, "${CURSOR_PLUGIN_ROOT}/hooks").replace(".js", ".cjs");
    await writeOrAppend(path.join(cursorHooksPath, "hooks.json"), cursorHooksConfig, "docuvia-hook.cjs");

    // 2. Setup Static Rules/Instructions (Copilot, Windsurf, Zed, Continue, Generic)
    
    // GitHub Copilot
    await writeOrAppend(path.join(cwd, GITHUB_DIR, "copilot-instructions.md"), AGENT_INSTRUCTIONS, "docuvia:start");
    
    // Claude Desktop / Generic Markdown
    await writeOrAppend(path.join(cwd, "CLAUDE.md"), AGENT_INSTRUCTIONS, "docuvia:start");
    
    // Windsurf
    await writeOrAppend(path.join(cwd, ".windsurfrules"), AGENT_INSTRUCTIONS, "docuvia:start");
    
    // Cursor Rules (Fallback for non-hook Cursor modes)
    await writeOrAppend(path.join(cwd, ".cursorrules"), AGENT_INSTRUCTIONS, "docuvia:start");
    
    // Standard LLM Crawler text
    await writeOrAppend(path.join(cwd, "llms.txt"), AGENT_INSTRUCTIONS, "docuvia:start");

    await registerMcpServer(cwd);

    console.log("\n🚀 Docuvia Agent Integrations successfully installed!");
    console.log("Supported platforms: Claude Code, Cursor, GitHub Copilot, Windsurf, Zed, Continue, OpenCode, Gemini CLI.");

  } catch (error) {
    console.error("❌ Failed to initialize agent integrations:", error);
    process.exit(1);
  }
}
