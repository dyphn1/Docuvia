import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import process from "process";

const spinnerNoop = { start: vi.fn().mockReturnThis() };

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    askConfirm: vi.fn(),
    askCheckbox: vi.fn(),
    spinner: vi.fn(() => spinnerNoop),
  },
}));

import { ClaudePlatform } from "../../../src/platforms/claude.platform.js";
import { ui } from "../../../src/ui/wizard.js";
import { CLAUDE_DESKTOP_CONFIG_FILENAME } from "../../../src/constants/init-templates.js";

describe("ClaudePlatform.configure — global MCP config gating", () => {
  let repoDir: string;
  let globalConfigDir: string;
  let originalAppData: string | undefined;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "docuvia-claude-platform-repo-"));
    globalConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "docuvia-claude-platform-global-"));
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = globalConfigDir;
    originalIsTTY = process.stdin.isTTY;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.rm(globalConfigDir, { recursive: true, force: true });
  });

  function globalConfigPath(): string {
    // resolveClaudeDesktopConfigDir() joins APPDATA with the platform name subfolder before
    // the config filename — mirror that here for assertions.
    return path.join(globalConfigDir, "Claude", CLAUDE_DESKTOP_CONFIG_FILENAME);
  }

  async function globalConfigExists(): Promise<boolean> {
    try {
      await fs.access(globalConfigPath());
      return true;
    } catch {
      return false;
    }
  }

  it("writes the global config when allowGlobalMcpConfig=true (--global passed)", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    const platform = new ClaudePlatform();
    await platform.configure(repoDir, true);

    expect(await globalConfigExists()).toBe(true);
    // Repo-scoped hooks are always written regardless of the global gate.
    expect(
      await fs.access(path.join(repoDir, ".claude", "hooks", "docuvia-hook.js")).then(
        () => true,
        () => false
      )
    ).toBe(true);
  });

  it("skips the global write in non-TTY mode without --global, but still configures local hooks", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    const platform = new ClaudePlatform();
    await platform.configure(repoDir, false);

    expect(await globalConfigExists()).toBe(false);
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("Skipped global"));
    expect(
      await fs.access(path.join(repoDir, ".claude", "hooks", "docuvia-hook.js")).then(
        () => true,
        () => false
      )
    ).toBe(true);
  });

  it("prompts for confirmation in TTY mode without --global, and skips the global write when declined", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    vi.mocked(ui.askConfirm).mockResolvedValue(false);

    const platform = new ClaudePlatform();
    await platform.configure(repoDir, false);

    expect(ui.askConfirm).toHaveBeenCalledWith(expect.stringContaining("machine-global"), false);
    expect(await globalConfigExists()).toBe(false);
  });

  it("writes the global config in TTY mode without --global when the confirmation is accepted", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    vi.mocked(ui.askConfirm).mockResolvedValue(true);

    const platform = new ClaudePlatform();
    await platform.configure(repoDir, false);

    expect(await globalConfigExists()).toBe(true);
  });
});
