#!/usr/bin/env node
/**
 * Docuvia Agent Hook
 * Intercepts AI searches and augments with high-density AST context from local SQLite.
 */
const { execSync } = require("child_process");

function readInput() {
  try {
    const data = require("fs").readFileSync(0, "utf-8");
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
    const context = execSync(
      `npx --no-install docuvia query "${target}" --local --format=prompt`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] },
    );
    if (context && context.trim().length > 0) {
      console.log("=== Docuvia Context injected ===");
      console.log(context);
      console.log("================================");
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error(
      "[Docuvia Pre-Command] Failed to retrieve context: " + errorMsg,
    );
  }
}
