import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import DatabaseCtor from "better-sqlite3";
import {
  acquireProcessLock,
  DOCUVIA_DIR_NAME,
  INIT_COMMAND_LOCK_FILE_NAME,
} from "@workspace/contracts";
import { initCommand } from "../../src/commands/init.js";
import { initTool } from "../../src/mcp/tools/init.js";
import {
  REAL_SUBPROCESS_TEST_TIMEOUT_MS,
  removeTempDir,
} from "../support/integration-env.js";

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
  execFileSync("git", ["config", "user.email", "test@docuvia.dev"], {
    cwd: tmpDir,
  });
  execFileSync("git", ["config", "user.name", "Docuvia Test"], { cwd: tmpDir });

  fs.writeFileSync(
    path.join(tmpDir, "index.ts"),
    "import { helper } from './helper';\nexport function main() { return helper(); }\n",
  );
  fs.writeFileSync(
    path.join(tmpDir, "helper.ts"),
    "export function helper() { return 42; }\n",
  );
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({
      name: "symmetry-fixture",
      version: "0.0.0",
      dependencies: { typescript: "^5" },
    }),
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
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'",
      )
      .all()
      .map((r: any) => r.name as string);

    const counts: Record<string, number> = {};
    for (const table of tables) {
      const row = raw.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as {
        c: number;
      };
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
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
  }, REAL_SUBPROCESS_TEST_TIMEOUT_MS);

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    // Windows-safe: `init` leaves git/SQLite handles that can outlive the test by milliseconds,
    // and a plain rmSync would throw EPERM *after* the assertions already passed.
    removeTempDir(workspaceA);
    removeTempDir(workspaceB);
  });

  it(
    "populates the same tables with equal row counts via both paths",
    async () => {
      // CLI path — non-interactive (isTTY=false).
      await initCommand(workspaceA);

      // MCP path — the tool handler resolves workspaceRoot from process.cwd() internally
      // (mirroring how the real MCP stdio server would run it). `process.chdir()` isn't
      // supported inside Vitest's worker threads, so stub `process.cwd()` instead of
      // actually changing directory — same effect for the handler's one `process.cwd()`
      // read, no need for a real stdio transport either.
      vi.spyOn(process, "cwd").mockReturnValue(workspaceB);
      const mcpResult = await initTool.handler({});
      expect(mcpResult.isError).toBeUndefined();

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
    },
    REAL_SUBPROCESS_TEST_TIMEOUT_MS,
  );

  /**
   * Regression test for a gap found 2026-07-18 (ADR audit against PLAT-006): the MCP `docuvia_init`
   * tool called `docuviaApi.init()` directly, bypassing the `init`-command single-flight lock the
   * CLI path acquires — so a CLI `docuvia init` racing a concurrent `docuvia_init` MCP call (an
   * AI-agent/editor integration point invoking init while a developer also runs it manually, the
   * exact scenario PLAT-006's own Advice section names as realistic) could hit the same
   * `UNIQUE(filename)` migration-race crash `dist-build.test.ts` reproduces for CLI-vs-CLI.
   *
   * Both paths now go through `withInitCommandLock`
   * (`artifacts/cli/src/utils/init-command-lock.ts`). This asserts the *mechanism* directly
   * (does the MCP tool actually acquire the same lockfile?) rather than trying to reproduce a
   * real OS-scheduling race in-process: unlike `dist-build.test.ts`'s CLI-vs-CLI regression test
   * (which needs separate `node dist/cli.js` processes to line up inside the race window,
   * because better-sqlite3's calls are synchronous and a single Node event loop can't interleave
   * mid-critical-section), an in-process `Promise.allSettled([initCommand(...), initTool.handler(...)])`
   * here was verified to pass even *without* the fix (confirmed by temporarily reverting it) — so
   * it would silently stop guarding this regression. Manually holding the lock and observing that
   * the MCP call blocks until it's released is deterministic and actually exercises the fix.
   */
  it(
    "MCP docuvia_init waits for the init-command lock instead of bypassing it",
    async () => {
      vi.spyOn(process, "cwd").mockReturnValue(workspaceA);

      const lockPath = path.join(
        workspaceA,
        DOCUVIA_DIR_NAME,
        INIT_COMMAND_LOCK_FILE_NAME,
      );
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      const heldLock = await acquireProcessLock(lockPath, {
        maxWaitMs: 5_000,
        heartbeatIntervalMs: 500,
        staleAfterMs: 60_000,
      });

      let mcpSettled = false;
      const mcpPromise = initTool.handler({}).then((result) => {
        mcpSettled = true;
        return result;
      });

      // An *unwrapped* docuviaApi.init() on this fixture reliably finishes in well under 1s (a
      // bare-minimum project, no LSP/LLM work) -- so a wait comfortably longer than that, still
      // observing mcpSettled === false while the lock is held, can only mean the MCP call is
      // actually blocked on the lock, not just "still doing real work." (A short ~300ms check was
      // tried first and false-negatived: unwrapped init took long enough on its own to still be
      // mid-flight at 300ms regardless of locking, making that window useless as a discriminator.)
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(
        mcpSettled,
        "MCP docuvia_init resolved while the init-command lock was still held by another " +
          "caller -- it isn't actually waiting on the lock (the PLAT-006 gap this test guards).",
      ).toBe(false);

      await heldLock.release();

      const mcpResult = await mcpPromise;
      expect(mcpSettled).toBe(true);
      expect(mcpResult.isError).toBeUndefined();

      const dbPath = path.join(workspaceA, ".docuvia", "local.db");
      expect(fs.existsSync(dbPath)).toBe(true);
      const counts = tableRowCounts(dbPath);
      expect(counts.projects).toBe(1);
    },
    REAL_SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
