// Shared with lib/ui-core's DoctorWorkflow agent-hooks diagnostic -- defined in @workspace/core so
// neither side depends on the other; re-exported here so this file stays the single import path
// every platform installer already uses.
export {
  CLAUDE_HOOKS_DIR,
  CURSOR_HOOKS_DIR,
  DOCUVIA_HOOK_JS_FILENAME,
  DOCUVIA_HOOK_CJS_FILENAME,
} from "@workspace/core";

export const GITHUB_DIR = ".github";

export const HOOKS_CONFIG_FILENAME = "hooks.json";

export const CURSOR_MCP_CONFIG_PATH = ".cursor/mcp.json";
export const CLAUDE_DESKTOP_CONFIG_FILENAME = "claude_desktop_config.json";
export const MCP_SERVER_ALIAS = "docuvia-local";

export const COPILOT_INSTRUCTIONS_FILENAME = "copilot-instructions.md";
export const CLAUDE_MD_FILENAME = "CLAUDE.md";
export const CURSOR_RULES_FILENAME = ".cursorrules";
export const AGENT_INSTRUCTIONS_MARKER = "docuvia:start";
export const AGENT_INSTRUCTIONS_END_MARKER = "docuvia:end";

// PLAT-008 legacy-only: these two files were written by the retired "Markdown Agents" catch-all
// and are never installed to anymore, but `uninstall` still best-effort cleans them up for repos
// set up under an older Docuvia version.
export const WINDSURF_RULES_FILENAME = ".windsurfrules";
export const LLMS_TXT_FILENAME = "llms.txt";

export const AGENTS_MD_FILENAME = "AGENTS.md";
export const HERMES_MD_FILENAME = ".hermes.md";
export const CONTINUE_RULES_DIR = ".continue/rules";
export const CONTINUE_RULES_FILENAME = "docuvia.md";

export const PLATFORM_NAME_CURSOR = "Cursor";
export const PLATFORM_NAME_CLAUDE = "Claude";
export const PLATFORM_NAME_COPILOT = "GitHub Copilot";
export const PLATFORM_NAME_CODEX = "Codex";
export const PLATFORM_NAME_CONTINUE = "Continue";
export const PLATFORM_NAME_HERMES = "Hermes Agent";

// Stable, CLI-facing identifiers for --platform= — PLATFORM_NAME_* above is the display name only.
export const PLATFORM_SLUG_CURSOR = "cursor";
export const PLATFORM_SLUG_CLAUDE = "claude";
export const PLATFORM_SLUG_COPILOT = "copilot";
export const PLATFORM_SLUG_CODEX = "codex";
export const PLATFORM_SLUG_CONTINUE = "continue";
export const PLATFORM_SLUG_HERMES = "hermes";

// Literal placeholder text written into each platform's hooks.json `${HOOKS_DIR}` substitution —
// the platform itself expands these at runtime, so they must stay un-interpolated here.
export const CLAUDE_PLUGIN_HOOKS_DIR = "${CLAUDE_PLUGIN_ROOT}/hooks";
export const CURSOR_PLUGIN_HOOKS_DIR = "${CURSOR_PLUGIN_ROOT}/hooks";

export const NPX_COMMAND = "npx";
export const NPX_YES_FLAG = "-y";
export const NPX_NO_INSTALL_FLAG = "--no-install";
export const DOCUVIA_MCP_LAUNCH_ARGS = ["docuvia", "mcp"];
export const DOCUVIA_WORKSPACE_ROOT_ENV_VAR = "DOCUVIA_WORKSPACE_ROOT";

export const DOCUVIA_HOOK_JS = `#!/usr/bin/env node
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
    const context = execSync(\`npx --no-install docuvia query "\${target}" --format=prompt\`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    if (context && context.trim().length > 0) {
      console.log("=== Docuvia Context injected ===");
      console.log(context);
      console.log("================================");
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("[Docuvia Pre-Command] Failed to retrieve context: " + errorMsg);
  }
}
`;

export const HOOKS_JSON = JSON.stringify(
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
  2,
);

export const AGENT_INSTRUCTIONS = `
<!-- ${AGENT_INSTRUCTIONS_MARKER} -->
# Docuvia — Codebase Knowledge Evolver

This project uses Docuvia to manage architectural context and prevent blast-radius regressions.
Grep/Glob/Read are the most expensive tools available to you — before reaching for them to explore the codebase, query the local knowledge graph instead, and before editing a symbol or file, check its blast radius:

Run: \`npx --no-install docuvia query "<concept_or_file>" --format=prompt\`
Run: \`npx --no-install docuvia impact <symbolOrFile>\`

Use the results to understand architectural boundaries, historical decisions, and potential blast radius before modifying code. Only fall back to Grep/Glob/Read when the graph returns nothing, the target is flagged \`tier_b_status="unprocessed"\` (unknown, not zero), or you need exact source text/formatting a structural query can't capture.
<!-- docuvia:end -->
`;
