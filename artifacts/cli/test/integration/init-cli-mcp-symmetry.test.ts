import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import DatabaseCtor from "better-sqlite3";
import { initCommand } from "../../src/commands/init.js";
import { initTool } from "../../src/mcp/tools/init.js";

/**
 * New test per the migration plan's step 9: asserts the MCP path (`docuvia_init` tool
 * handler, called directly — no need for a real stdio transport) and the CLI path
 * (`docuvia init`) produce the same effective result for the same fixture workspace. Old
 * Docuvia's two paths were never symmetric enough to test this way (MCP's `init` tool did
 * `new InitService(process.cwd())` directly instead of going through the CLI's own setup);
 * this test is the concrete proof that both surfaces now call the identical
 * `buildInitCapability` composition root.
 */
function makeGitFixture(prefix: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync("git", ["init", "-b", "main"], { cwd: tmpDir });
  execFileSync("git", ["config", "user.email", "test@docuvia.dev"], { cwd: tmpDir });
  execFileSync("git", ["config", "user.name", "Docuvia Test"], { cwd: tmpDir });

  fs.writeFileSync(
    path.join(tmpDir, "index.ts"),
    "import { helper } from './helper';\nexport function main() { return helper(); }\n"
  );
  fs.writeFileSync(path.join(tmpDir, "helper.ts"), "export function helper() { return 42; }\n");
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({
      name: "symmetry-fixture",
      version: "0.0.0",
      dependencies: { typescript: "^5" },
    })
  );

  execFileSync("git", ["add", "."], { cwd: tmpDir });
  execFileSync("git", ["commit", "-m", "initial commit"], { cwd: tmpDir });
  return tmpDir;
}

function tableRowCounts(dbPath: string): Record<string, number> {
  const raw = new DatabaseCtor(dbPath, { readonly: true });
  try {
    const tables = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'"
      )
      .all()
      .map((r: any) => r.name as string);

    const counts: Record<string, number> = {};
    for (const table of tables) {
      const row = raw.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as { c: number };
      counts[table] = row.c;
    }
    return counts;
  } finally {
    raw.close();
  }
}

describe("CLI `docuvia init` and MCP `docuvia_init` produce equivalent local.db contents", () => {
  let workspaceA: string;
  let workspaceB: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    workspaceA = makeGitFixture("docuvia-symmetry-cli-");
    workspaceB = makeGitFixture("docuvia-symmetry-mcp-");
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  }, 30_000);

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    fs.rmSync(workspaceA, { recursive: true, force: true });
    fs.rmSync(workspaceB, { recursive: true, force: true });
  });

  it("populates the same tables with equal row counts via both paths", async () => {
    // CLI path — non-interactive (isTTY=false), no --global.
    await initCommand(workspaceA, false);

    // MCP path — the tool handler resolves workspaceRoot from process.cwd() internally
    // (mirroring how the real MCP stdio server would run it). `process.chdir()` isn't
    // supported inside Vitest's worker threads, so stub `process.cwd()` instead of
    // actually changing directory — same effect for the handler's one `process.cwd()`
    // read, no need for a real stdio transport either.
    vi.spyOn(process, "cwd").mockReturnValue(workspaceB);
    const mcpResult = await initTool.handler({});
    expect(mcpResult.isError).toBeFalsy();

    const dbPathA = path.join(workspaceA, ".docuvia", "local.db");
    const dbPathB = path.join(workspaceB, ".docuvia", "local.db");
    expect(fs.existsSync(dbPathA)).toBe(true);
    expect(fs.existsSync(dbPathB)).toBe(true);

    const countsA = tableRowCounts(dbPathA);
    const countsB = tableRowCounts(dbPathB);

    expect(Object.keys(countsA).sort()).toEqual(Object.keys(countsB).sort());
    expect(countsA).toEqual(countsB);

    // Sanity: both actually ingested the fixture (not just empty tables matching each other).
    expect(countsA.projects).toBe(1);
    expect(countsA.project_files).toBeGreaterThanOrEqual(2);
    expect(countsA.l2_nodes).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
