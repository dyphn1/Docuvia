#!/usr/bin/env node
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

// `docuvia hooks disable context-injection`'s enforcement (issue #42 §7.5) -- a
// plain synchronous read, no subprocess: this hook fires on every Grep/Glob/Bash/Read, so a
// second `npx docuvia ...` spawn per call would be a real, continuous latency cost, not a
// one-off. Missing/unparseable config -> enabled (fail open, matches the always-on behavior this
// toggle is retrofitted onto).
function isEnabled() {
  try {
    const config = JSON.parse(
      require('fs').readFileSync('.docuvia/hooks-config.json', 'utf-8'),
    );
    return config['context-injection'] !== false;
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
