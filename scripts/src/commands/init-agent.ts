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
    const context = execSync(\`npx --no-install docuvia query local --context "\${target}"\`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
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

Run: \`npx --no-install docuvia query local --context "<concept_or_file>"\`

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

    console.log("\n🚀 Docuvia Agent Integrations successfully installed!");
    console.log("Supported platforms: Claude Code, Cursor, GitHub Copilot, Windsurf, Zed, Continue, OpenCode, Gemini CLI.");

  } catch (error) {
    console.error("❌ Failed to initialize agent integrations:", error);
    process.exit(1);
  }
}
