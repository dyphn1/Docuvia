// Shared with lib/ui-core's DoctorWorkflow agent-hooks diagnostic -- defined in
// @workspace/contracts so neither side depends on the other; re-exported here so this file
// stays the single import path
// every platform installer already uses. Also imported (not just re-exported) below so
// CLAUDE_PROJECT_HOOKS_DIR can build off the same value instead of re-typing it.
import { CLAUDE_HOOKS_DIR } from "@workspace/contracts";
export {
  CLAUDE_HOOKS_DIR,
  CURSOR_HOOKS_DIR,
  DOCUVIA_HOOK_JS_FILENAME,
  DOCUVIA_HOOK_CJS_FILENAME,
} from "@workspace/contracts";
// `context-injection`'s enforcement gate (issue #42 §7.5): this file is itself normal
// TypeScript, so it can import the shared literal values and interpolate them into the
// generated `.js` template text at compile time -- the *generated* raw hook script on disk just
// contains the resolved strings, no runtime import (a standalone `.js` hook file has no
// `@workspace/contracts` to import from).
import {
  HookNames,
  HOOKS_CONFIG_FILE_NAME,
  DOCUVIA_DIR_NAME,
} from "@workspace/contracts";

export const GITHUB_DIR = ".github";
export const CLAUDE_DIR = ".claude";

export const HOOKS_CONFIG_FILENAME = "hooks.json";
export const SETTINGS_JSON_FILENAME = "settings.json";

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

// Project-level equivalent of CLAUDE_PLUGIN_HOOKS_DIR above. `${CLAUDE_PLUGIN_ROOT}` only resolves
// inside a formal Claude Code plugin install (and is currently broken there too --
// anthropics/claude-code#24529); `${CLAUDE_PROJECT_DIR}` resolves correctly today in a project-level
// `.claude/settings.json` hook, so ClaudePlatform also writes a hook entry through this path,
// pointing at the same `.claude/hooks` dir `configureHooks` already writes `docuvia-hook.js` into
// (roadmap-and-open-items.md item 26).
export const CLAUDE_PROJECT_HOOKS_DIR =
  "${CLAUDE_PROJECT_DIR}/" + CLAUDE_HOOKS_DIR;

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
const { execFileSync } = require('child_process');

function readInput() {
  try {
    const data = require('fs').readFileSync(0, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// \`docuvia hooks disable ${HookNames.CONTEXT_INJECTION}\`'s enforcement (issue #42 §7.5) -- a
// plain synchronous read, no subprocess: this hook fires on every Grep/Glob/Bash/Read, so a
// second \`npx docuvia ...\` spawn per call would be a real, continuous latency cost, not a
// one-off. Missing/unparseable config -> enabled (fail open, matches the always-on behavior this
// toggle is retrofitted onto).
function isEnabled() {
  try {
    const config = JSON.parse(
      require('fs').readFileSync('${DOCUVIA_DIR_NAME}/${HOOKS_CONFIG_FILE_NAME}', 'utf-8'),
    );
    return config['${HookNames.CONTEXT_INJECTION}'] !== false;
  } catch {
    return true;
  }
}

const input = readInput();
// Use the query arguments as the target to retrieve context
const target = input.args ? input.args.query || input.args.pattern : null;

if (target && isEnabled()) {
  try {
    // Call the local Docuvia CLI to retrieve exact L2/L3 structural context. target is passed as a
    // literal argv element via execFileSync (no shell) instead of string-interpolated into an
    // execSync shell command (issue #51): target is tool-call input (Grep/Glob/Bash/Read
    // query/pattern) that an agent or, transitively, a prompt can influence, so the old
    // interpolation was a real shell-injection exposure. npx is a .cmd shim on Windows that
    // execFileSync can't spawn as a bare name, so resolve the platform-specific name inline (this
    // standalone script can't import windows-shell-spawn.ts).
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const context = execFileSync(
      npx,
      ['--no-install', 'docuvia', 'query', target, '--format=prompt'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
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

// Named so the merge/prune logic in claude.platform.ts's project-level `.claude/settings.json`
// support reuses this exact key instead of re-typing the literal (a typo there would silently
// desync the two).
export const HOOK_EVENT_PRE_TOOL_USE = "PreToolUse";

export const HOOKS_JSON = JSON.stringify(
  {
    [HOOK_EVENT_PRE_TOOL_USE]: [
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

Use the results to understand architectural boundaries, historical decisions, and potential blast radius before modifying code. Only fall back to Grep/Glob/Read when the graph returns nothing, the target is flagged \`tier_b_status="unprocessed"\` (unknown, not zero), you need exact source text/formatting a structural query can't capture, or \`query\` returns a non-\`exact\` \`match_type\` (keyword/neighbor) for what should be a well-known symbol or file.

After making a code change that reflects a real architectural decision, rule, or notable rationale, stage it so the graph picks it up without a separate write step:

Run: \`npx --no-install docuvia analyze <file> --agent-authored --stage\`

Pipe a JSON payload on stdin (default) — \`{"decisions":[{"title":string,"content":string,"nodeType":"change"|"rule"|"decision"|"context","confidence":number}]}\` — or pass \`--decisions-file=<path>\` instead. Put \`--agent-authored\`/\`--stage\` after the positional \`<file>\`, not before — a flag preceding the path silently swallows it as the flag's own value. Staged decisions flush into the knowledge graph automatically the next time you commit a change touching that file — nothing else to run.
<!-- docuvia:end -->
`;
