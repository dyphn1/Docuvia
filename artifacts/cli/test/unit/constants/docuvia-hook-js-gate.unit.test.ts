import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import process from "process";
import fs from "fs";
import os from "os";
import path from "path";
import { DOCUVIA_HOOK_JS } from "../../../src/constants/init-templates.js";

/**
 * `DOCUVIA_HOOK_JS`'s `isEnabled()` gate (issue #42 §7.5 -- `docuvia hooks disable
 * context-injection`'s enforcement). `DOCUVIA_HOOK_JS` is a raw, standalone Node script template
 * (no test harness of its own, and `claude.platform.unit.test.ts` never asserts on its content
 * directly), so this runs the *actual* generated script text as a real child process against a
 * real `.docuvia/hooks-config.json` fixture -- the only way to exercise this logic as shipped,
 * since it's a string template embedded in a `.ts` file, not an importable function.
 */
describe("DOCUVIA_HOOK_JS's isEnabled() gate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-hook-js-gate-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeHooksConfig(config: Record<string, boolean>): void {
    const dir = path.join(tmpDir, ".docuvia");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "hooks-config.json"),
      JSON.stringify(config),
    );
  }

  /** Appends a call to the script's own top-level `isEnabled()` and prints its result --
   *  exercises the real function without ever reaching the `execSync` network call. */
  function runIsEnabledProbe(): string {
    const scriptPath = path.join(tmpDir, "docuvia-hook.js");
    fs.writeFileSync(
      scriptPath,
      `${DOCUVIA_HOOK_JS}\nconsole.log("ISENABLED:" + isEnabled());\n`,
    );
    return execFileSync(process.execPath, [scriptPath], {
      cwd: tmpDir,
      input: "{}",
      encoding: "utf-8",
    });
  }

  it("defaults to enabled when .docuvia/hooks-config.json doesn't exist", () => {
    expect(runIsEnabledProbe()).toContain("ISENABLED:true");
  });

  it("returns false when hooks-config.json explicitly disables context-injection", () => {
    writeHooksConfig({ "context-injection": false });
    expect(runIsEnabledProbe()).toContain("ISENABLED:false");
  });

  it("returns true when hooks-config.json explicitly enables context-injection", () => {
    writeHooksConfig({ "context-injection": true });
    expect(runIsEnabledProbe()).toContain("ISENABLED:true");
  });

  it("fails open (enabled) on corrupt JSON", () => {
    const dir = path.join(tmpDir, ".docuvia");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "hooks-config.json"), "not json");

    expect(runIsEnabledProbe()).toContain("ISENABLED:true");
  });

  it("short-circuits before execSync (no output at all) when disabled, even with a target", () => {
    writeHooksConfig({ "context-injection": false });

    const scriptPath = path.join(tmpDir, "docuvia-hook.js");
    fs.writeFileSync(scriptPath, DOCUVIA_HOOK_JS);
    const output = execFileSync(process.execPath, [scriptPath], {
      cwd: tmpDir,
      input: JSON.stringify({ args: { query: "foo" } }),
      encoding: "utf-8",
    });

    expect(output.trim()).toBe("");
  });
});
