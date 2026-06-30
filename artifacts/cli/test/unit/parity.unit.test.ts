import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// --- Helpers ---
function extractIdentifiers(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map(m => m[1]);
}

function findMissing(expected: string[], actual: string[], ignored: Set<string>): string[] {
  return expected.filter(item => !ignored.has(item) && !actual.includes(item));
}

describe("Interface Parity Tests (CLI vs MCP)", () => {
  it("should ensure all core CLI commands have equivalent MCP tools", () => {
    // --- Arrange ---
    const cliSource = readFileSync(resolve(__dirname, "../../src/cli.ts"), "utf-8");
    const mcpSource = readFileSync(resolve(__dirname, "../../src/mcp/server.ts"), "utf-8");

    const ignoredCliCommands = new Set(["init-agent", "mcp"]);
    const ignoredMcpTools = new Set(["context", "impact"]); // Exclusively MCP for now

    // --- Act ---
    const cliCommands = extractIdentifiers(cliSource, /command === "([^"]+)"/g);
    
    // Map MCP tools (e.g., docuvia_detect_changes) to CLI format (detect-changes)
    const mcpTools = extractIdentifiers(mcpSource, /name:\s*"docuvia_([^"]+)"/g)
      .map(tool => tool.replace(/_/g, "-"))
      .map(tool => tool === "query-local" ? "query" : tool); // Normalize query command

    const missingInMcp = findMissing(cliCommands, mcpTools, ignoredCliCommands);
    const missingInCli = findMissing(mcpTools, cliCommands, ignoredMcpTools);

    // --- Assert ---
    const driftMessage = `
    Parity drift detected between CLI commands and MCP Tools!
    Missing in MCP: ${missingInMcp.join(", ") || "None"}
    Missing in CLI: ${missingInCli.join(", ") || "None"}
    
    Rule: CLI commands, MCP tool names, and VS Code command IDs must align conceptually and structurally.
    `;

    expect(missingInMcp.length).toBe(0, driftMessage);
    expect(missingInCli.length).toBe(0, driftMessage);
  });
});
