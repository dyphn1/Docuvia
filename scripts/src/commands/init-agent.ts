import * as fs from "fs/promises";
import * as path from "path";

const CLAUDE_HOOKS_DIR = ".claude/hooks";
const CURSOR_HOOKS_DIR = ".cursor/hooks";

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
    // This assumes \`docuvia query local --context <target>\` exists and outputs concise text
    const context = execSync(\`npx --no-install docuvia query local --context "\${target}"\`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (context && context.trim().length > 0) {
      console.log("=== Docuvia Context injected ===");
      console.log(context);
      console.log("================================");
    }
  } catch (e) {
    // Fail silently to not disrupt the agent's normal tool execution
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

export async function initAgent(cwd: string = process.cwd()) {
  console.log("Initializing AI Agent hooks for Docuvia...");

  const claudeHooksPath = path.join(cwd, CLAUDE_HOOKS_DIR);
  const cursorHooksPath = path.join(cwd, CURSOR_HOOKS_DIR);

  try {
    // Setup for Claude Code
    await fs.mkdir(claudeHooksPath, { recursive: true });
    await fs.writeFile(path.join(claudeHooksPath, "docuvia-hook.js"), DOCUVIA_HOOK_JS, { mode: 0o755 });
    
    // Read or create hooks.json
    const claudeHooksJsonPath = path.join(claudeHooksPath, "hooks.json");
    let claudeHooksConfig = HOOKS_JSON;
    // Replace ${HOOKS_DIR} with actual path variable for Claude
    claudeHooksConfig = claudeHooksConfig.replace(/\${HOOKS_DIR}/g, "${CLAUDE_PLUGIN_ROOT}/hooks");
    
    // Very simplistic merge if exists (in reality we'd parse and merge arrays)
    try {
      await fs.access(claudeHooksJsonPath);
      console.log(`✅ File already exists, skipping overwrite: ${claudeHooksJsonPath}`);
    } catch {
      await fs.writeFile(claudeHooksJsonPath, claudeHooksConfig);
      console.log(`✅ Created: ${claudeHooksJsonPath}`);
    }
    
    // Setup for Cursor (similar structure)
    await fs.mkdir(cursorHooksPath, { recursive: true });
    await fs.writeFile(path.join(cursorHooksPath, "docuvia-hook.cjs"), DOCUVIA_HOOK_JS, { mode: 0o755 });
    
    const cursorHooksJsonPath = path.join(cursorHooksPath, "hooks.json");
    let cursorHooksConfig = HOOKS_JSON;
    cursorHooksConfig = cursorHooksConfig.replace(/\${HOOKS_DIR}/g, "${CURSOR_PLUGIN_ROOT}/hooks").replace(".js", ".cjs");
    
    try {
      await fs.access(cursorHooksJsonPath);
      console.log(`✅ File already exists, skipping overwrite: ${cursorHooksJsonPath}`);
    } catch {
      await fs.writeFile(cursorHooksJsonPath, cursorHooksConfig);
      console.log(`✅ Created: ${cursorHooksJsonPath}`);
    }

    console.log("\n🚀 Docuvia Agent Hooks successfully installed!");
    console.log("Your AI agents (Claude Code, Cursor) will now automatically receive high-density context from Docuvia before searching the codebase.");

  } catch (error) {
    console.error("❌ Failed to initialize agent hooks:", error);
    process.exit(1);
  }
}
