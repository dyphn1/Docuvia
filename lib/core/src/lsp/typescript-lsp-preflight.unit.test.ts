import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkTypeScriptLspPreflight } from "./typescript-lsp-preflight.js";
import { rmSyncRetrying } from "./windows-rm-retry.test-support.js";

/**
 * `checkTypeScriptLspPreflight()`'s `npx --no-install typescript-language-server --version` probe
 * (`probeNpxResolvable()` in `typescript-lsp-preflight.ts`) goes through `node:child_process`'s `execFile` --
 * mocked here to always report "not found" so these tests are deterministic regardless of this
 * machine's actual npx cache/install state, rather than depending on a real subprocess round-trip
 * the way this file originally did. That real-probe approach turned out not to be the "not flaky"
 * bet it was assumed to be: confirmed 2026-07-30, a real npx cache populated by unrelated same-day
 * LSP testing made "reports the LSP binary as unresolvable..." below fail, because the real `npx
 * --no-install typescript-language-server --version` subprocess it exercised genuinely started
 * succeeding on this machine. (Note for anyone tempted to copy the `vi.spyOn(child_process,
 * "execFile")` pattern used by some sibling `*-lsp-preflight.unit.test.ts` files instead: that
 * does NOT actually intercept anything here, confirmed by direct testing -- `typescript-lsp-preflight.ts` and
 * `windows-shell-spawn.ts` each capture `promisify(execFile)` once at their own module-load time,
 * before any spy is installed, so a later `vi.spyOn` on the property never reaches those
 * already-closed-over references. `vi.mock` below replaces the module's export before those
 * modules import it, which does work.) None of the assertions in this file depend on the probe
 * ever genuinely succeeding -- the one test below that would (binary-override) never reaches the
 * probe at all, since an explicit override short-circuits `resolveTypeScriptLspBinary()` first.
 */
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn((...args: unknown[]) => {
      const callback = args[args.length - 1];
      if (typeof callback === "function") {
        (callback as (...cbArgs: unknown[]) => void)(
          new Error("simulated: npx cannot resolve the LSP binary"),
          "",
          "",
        );
      }
      return {} as ReturnType<typeof actual.execFile>;
    }),
  };
});

describe("checkTypeScriptLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-lsp-preflight-"),
    );
  });

  afterEach(async () => {
    await rmSyncRetrying(workspaceRoot);
  });

  it("reports not ready with a reason when node_modules is missing", async () => {
    const result = await checkTypeScriptLspPreflight(workspaceRoot);

    expect(result.nodeModulesPresent).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason!.length).toBeGreaterThanOrEqual(1);
  }, 15000);

  it("reports not ready when node_modules exists but no tsconfig/jsconfig does", async () => {
    fs.mkdirSync(path.join(workspaceRoot, "node_modules"));

    const result = await checkTypeScriptLspPreflight(workspaceRoot);

    expect(result.nodeModulesPresent).toBe(true);
    expect(result.tsconfigResolvable).toBe(false);
    expect(result.ready).toBe(false);
  }, 15000);

  it("is ready when an explicit binary override always resolves, regardless of npx", async () => {
    fs.mkdirSync(path.join(workspaceRoot, "node_modules"));
    fs.writeFileSync(path.join(workspaceRoot, "tsconfig.json"), "{}");

    const result = await checkTypeScriptLspPreflight(workspaceRoot, {
      binary: "/fake/but/overridden",
    });

    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  }, 15000);

  it("reports the LSP binary as unresolvable when neither a local copy nor npx can find it", async () => {
    fs.mkdirSync(path.join(workspaceRoot, "node_modules"));
    fs.writeFileSync(path.join(workspaceRoot, "tsconfig.json"), "{}");

    const result = await checkTypeScriptLspPreflight(workspaceRoot);

    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/not resolvable/);
  }, 15000);
});
