import { describe, it, expect, afterEach, vi } from "vitest";
import {
  needsWindowsShellWrapper,
  isWindowsShellOnlyBareCommand,
  quoteForWindowsShell,
  buildWindowsShellCommandLine,
} from "./windows-shell-spawn.js";

describe("needsWindowsShellWrapper()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is always false off win32, regardless of the command", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    expect(needsWindowsShellWrapper("npx")).toBe(false);
    expect(needsWindowsShellWrapper("C:\\bin\\server.cmd")).toBe(false);
  });

  it("is true for a bare 'npx' on win32 -- the bug this module exists to fix, since a bare execFile/spawn cannot exec npx's .cmd shim directly", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    expect(needsWindowsShellWrapper("npx")).toBe(true);
    expect(needsWindowsShellWrapper("NPX")).toBe(true);
  });

  it("is true for a resolved .cmd/.bat/.ps1 node_modules/.bin path on win32", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    expect(
      needsWindowsShellWrapper("C:\\proj\\node_modules\\.bin\\ts.cmd"),
    ).toBe(true);
    expect(
      needsWindowsShellWrapper("C:\\proj\\node_modules\\.bin\\ts.bat"),
    ).toBe(true);
  });

  it("is false for an ordinary resolved .exe path on win32", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    expect(needsWindowsShellWrapper("C:\\tools\\rust-analyzer.exe")).toBe(
      false,
    );
  });
});

describe("isWindowsShellOnlyBareCommand()", () => {
  it("is true only for npx (case-insensitive), false for anything else including resolved paths", () => {
    expect(isWindowsShellOnlyBareCommand("npx")).toBe(true);
    expect(isWindowsShellOnlyBareCommand("NPX")).toBe(true);
    expect(isWindowsShellOnlyBareCommand("rust-analyzer")).toBe(false);
    expect(isWindowsShellOnlyBareCommand("C:\\bin\\npx.cmd")).toBe(false);
  });
});

describe("quoteForWindowsShell()", () => {
  it("wraps a plain token in double quotes", () => {
    expect(quoteForWindowsShell("--no-install")).toBe('"--no-install"');
  });

  it("doubles embedded double quotes per cmd.exe's own escaping convention", () => {
    expect(quoteForWindowsShell('say "hi"')).toBe('"say ""hi"""');
  });
});

describe("buildWindowsShellCommandLine()", () => {
  // The `where` probe this exercises only exists on Windows; on POSIX hosts the probe
  // cannot resolve `npx` at all, so the quoted-bare-token result this asserts against is
  // meaningless there (issue #7).
  it.skipIf(process.platform !== "win32")(
    "resolves a bare 'npx' to its full path via the where probe before quoting",
    async () => {
      const args = ["--no-install", "typescript-language-server", "--version"];
      const commandLine = await buildWindowsShellCommandLine(
        "npx",
        args,
        undefined,
      );

      // The resolved path is platform/PATH-dependent, but it must never be the bare, unresolved
      // "npx" token -- that's exactly the bug this function exists to avoid (a bare-name shell PATH
      // search re-triggers the npm-prefix.js-relative-to-cwd bug documented in this module).
      expect(commandLine).not.toMatch(/^"npx"/i);
      expect(commandLine).toContain('"--no-install"');
      expect(commandLine).toContain('"typescript-language-server"');
      expect(commandLine).toContain('"--version"');
    },
  );

  it("leaves a non-bare-command's own name untouched (only quotes it), since only npx needs the extra where-resolution step", async () => {
    const commandLine = await buildWindowsShellCommandLine(
      "C:\\proj\\node_modules\\.bin\\ts.cmd",
      ["--stdio"],
      undefined,
    );
    expect(commandLine).toBe(
      '"C:\\proj\\node_modules\\.bin\\ts.cmd" "--stdio"',
    );
  });
});
