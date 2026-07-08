export const CLAUDE_HOOKS_DIR = ".claude/hooks";
export const CURSOR_HOOKS_DIR = ".cursor/hooks";
export const GITHUB_DIR = ".github";

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
    const context = execSync(\`npx --no-install docuvia query "\${target}" --local --format=prompt\`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
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
  2
);

export const GIT_POST_COMMIT_HOOK = `#!/bin/bash
# Docuvia Knowledge Graph Evolver Hook
# Non-intrusively extracts AST deltas in the background
if command -v npx &> /dev/null; then
  # Fire and forget (do not block commit)
  npx --no-install docuvia snapshot > /dev/null 2>&1 &
fi
`;

export const AGENT_INSTRUCTIONS = `
<!-- docuvia:start -->
# Docuvia — Codebase Knowledge Evolver

This project uses Docuvia to manage architectural context and prevent blast-radius regressions.
Before you explore the codebase (using Grep/Glob/Read) or make structural changes, you MUST query the local knowledge graph:

Run: \`npx --no-install docuvia query "<concept_or_file>" --local --format=prompt\`

Use the results from this command to understand architectural boundaries, historical decisions, and potential blast radius before modifying code.
<!-- docuvia:end -->
`;
