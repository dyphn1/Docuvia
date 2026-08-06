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

// `resolveClaudeDesktopConfigDir()` reads `APPDATA` on win32 but `HOME` on darwin/linux, so the
// temp-dir redirect below must target whichever env var the current platform actually reads —
// mocking only `APPDATA` silently fails every global-path assertion off Windows.
function redirectGlobalConfigEnv(dir: string): () => void {
  const key = process.platform === "win32" ? "APPDATA" : "HOME";
  const previous = process.env[key];
  process.env[key] = dir;
  return () => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  };
}

function globalConfigPathFor(globalConfigDir: string): string {
  const subdir =
    process.platform === "win32"
      ? "Claude"
      : process.platform === "darwin"
        ? path.join("Library", "Application Support", "Claude")
        : path.join(".config", "Claude");
  return path.join(globalConfigDir, subdir, CLAUDE_DESKTOP_CONFIG_FILENAME);
}

// Roadmap item 26 — project-level `.claude/settings.json` PreToolUse hook (the `${CLAUDE_PLUGIN_ROOT}`
// hooks.json path above is inert outside formal plugin packaging; `${CLAUDE_PROJECT_DIR}` resolves
// in a plain checkout today).
describe("ClaudePlatform — project-level .claude/settings.json hook (roadmap item 26)", () => {
  let repoDir: string;
  let globalConfigDir: string;
  let originalAppData: string | undefined;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "docuvia-claude-platform-settings-"),
    );
    globalConfigDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "docuvia-claude-platform-settings-global-"),
    );
    originalAppData = process.env.APPDATA;
    process.env.APPDATA = globalConfigDir;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.rm(globalConfigDir, { recursive: true, force: true });
  });

  function settingsPath(): string {
    return path.join(repoDir, ".claude", "settings.json");
  }

  async function readSettings(): Promise<any> {
    return JSON.parse(await fs.readFile(settingsPath(), "utf-8"));
  }

  it("installHooks writes .claude/settings.json with a PreToolUse entry referencing ${CLAUDE_PROJECT_DIR}/.claude/hooks/docuvia-hook.js", async () => {
    const platform = new ClaudePlatform();
    await platform.installHooks(repoDir);

    const settings = await readSettings();
    const preToolUse = settings.hooks.PreToolUse;
    expect(Array.isArray(preToolUse)).toBe(true);
    const docuviaEntry = preToolUse.find((entry: any) =>
      entry.hooks?.some((h: any) =>
        h.command?.includes("${CLAUDE_PROJECT_DIR}"),
      ),
    );
    expect(docuviaEntry).toBeDefined();
    const command = docuviaEntry.hooks[0].command as string;
    expect(command).toContain("${CLAUDE_PROJECT_DIR}");
    expect(command).toContain(".claude/hooks/docuvia-hook.js");
  });

  it("is idempotent — calling installHooks twice does not duplicate the PreToolUse entry", async () => {
    const platform = new ClaudePlatform();
    await platform.installHooks(repoDir);
    await platform.installHooks(repoDir);

    const settings = await readSettings();
    const preToolUse = settings.hooks.PreToolUse;
    const docuviaEntries = preToolUse.filter((entry: any) =>
      entry.hooks?.some((h: any) =>
        h.command?.includes("${CLAUDE_PROJECT_DIR}"),
      ),
    );
    expect(docuviaEntries).toHaveLength(1);
  });

  const seedContent = {
    permissions: { allow: ["Bash(git *)"] },
    hooks: {
      PreToolUse: [
        {
          matcher: "SomeOtherTool",
          hooks: [{ type: "command", command: "echo hi" }],
        },
      ],
    },
  };

  async function seedSettings(): Promise<void> {
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
    await fs.writeFile(settingsPath(), JSON.stringify(seedContent, null, 2));
  }

  it("installHooks preserves pre-existing unrelated content in .claude/settings.json", async () => {
    await seedSettings();

    const platform = new ClaudePlatform();
    await platform.installHooks(repoDir);

    const settings = await readSettings();
    expect(settings.permissions).toEqual({ allow: ["Bash(git *)"] });
    const preToolUse = settings.hooks.PreToolUse;
    expect(
      preToolUse.some((entry: any) => entry.matcher === "SomeOtherTool"),
    ).toBe(true);
    expect(
      preToolUse.some((entry: any) =>
        entry.hooks?.some((h: any) =>
          h.command?.includes("${CLAUDE_PROJECT_DIR}"),
        ),
      ),
    ).toBe(true);
  });

  it("uninstallHooks removes only Docuvia's entry from .claude/settings.json, leaving other pre-existing content intact", async () => {
    await seedSettings();

    const platform = new ClaudePlatform();
    await platform.installHooks(repoDir);
    await platform.uninstallHooks(repoDir);

    const settings = await readSettings();
    expect(settings.permissions).toEqual({ allow: ["Bash(git *)"] });
    const preToolUse = settings.hooks.PreToolUse;
    expect(
      preToolUse.some((entry: any) => entry.matcher === "SomeOtherTool"),
    ).toBe(true);
    expect(
      preToolUse.some((entry: any) =>
        entry.hooks?.some((h: any) =>
          h.command?.includes("${CLAUDE_PROJECT_DIR}"),
        ),
      ),
    ).toBe(false);
  });

  it("uninstallHooks deletes .claude/settings.json entirely when Docuvia's entry was the only content", async () => {
    const platform = new ClaudePlatform();
    await platform.installHooks(repoDir);
    await platform.uninstallHooks(repoDir);

    const exists = await fs.access(settingsPath()).then(
      () => true,
      () => false,
    );
    expect(exists).toBe(false);
  });

  it("uninstallHooks is a safe no-op when .claude/settings.json does not exist", async () => {
    const platform = new ClaudePlatform();
    await expect(platform.uninstallHooks(repoDir)).resolves.not.toThrow();

    const exists = await fs.access(settingsPath()).then(
      () => true,
      () => false,
    );
    expect(exists).toBe(false);
  });

  it("uninstallHooks is a safe no-op when .claude/settings.json contains invalid JSON, and never overwrites it", async () => {
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
    await fs.writeFile(settingsPath(), "{ not valid json");

    const platform = new ClaudePlatform();
    await expect(platform.uninstallHooks(repoDir)).resolves.not.toThrow();

    const after = await fs.readFile(settingsPath(), "utf-8");
    expect(after).toBe("{ not valid json");
  });

  it("installHooks warns and does not overwrite .claude/settings.json when it contains invalid JSON", async () => {
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
    await fs.writeFile(settingsPath(), "{ not valid json");

    const platform = new ClaudePlatform();
    await platform.installHooks(repoDir);

    const after = await fs.readFile(settingsPath(), "utf-8");
    expect(after).toBe("{ not valid json");
    expect(ui.warn).toHaveBeenCalled();
  });

  it("installHooks warns and does not overwrite .claude/settings.json when PreToolUse is present but not an array", async () => {
    const malformedContent = { hooks: { PreToolUse: {} } };
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
    await fs.writeFile(
      settingsPath(),
      JSON.stringify(malformedContent, null, 2),
    );

    const platform = new ClaudePlatform();
    await expect(platform.installHooks(repoDir)).resolves.not.toThrow();

    const after = await readSettings();
    expect(after.hooks.PreToolUse).toEqual({});
    expect(ui.warn).toHaveBeenCalled();
  });
});

// IFCE-002: Docuvia never writes machine-global state. `installHooks` must only touch the
// repo-scoped `.claude/hooks/` directory and print a copy-pasteable MCP snippet — it must never
// write to Claude Desktop's own (machine-global) config file, regardless of TTY or flags.
describe("ClaudePlatform.installHooks — no machine-global writes (IFCE-002)", () => {
  let repoDir: string;
  let globalConfigDir: string;
  let restoreGlobalConfigEnv: () => void;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "docuvia-claude-platform-repo-"),
    );
    globalConfigDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "docuvia-claude-platform-global-"),
    );
    restoreGlobalConfigEnv = redirectGlobalConfigEnv(globalConfigDir);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    restoreGlobalConfigEnv();
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.rm(globalConfigDir, { recursive: true, force: true });
  });

  function globalConfigPath(): string {
    // Mirror resolveClaudeDesktopConfigDir()'s platform subdir before the config filename.
    return globalConfigPathFor(globalConfigDir);
  }

  async function globalConfigExists(): Promise<boolean> {
    try {
      await fs.access(globalConfigPath());
      return true;
    } catch {
      return false;
    }
  }

  it("never writes Claude Desktop's global config file", async () => {
    const platform = new ClaudePlatform();
    await platform.installHooks(repoDir);

    expect(await globalConfigExists()).toBe(false);
  });

  it("always configures the repo-scoped hooks", async () => {
    const platform = new ClaudePlatform();
    await platform.installHooks(repoDir);

    expect(
      await fs
        .access(path.join(repoDir, ".claude", "hooks", "docuvia-hook.js"))
        .then(
          () => true,
          () => false,
        ),
    ).toBe(true);
  });

  it("prints a copy-pasteable MCP snippet naming the global config path, instead of writing it", async () => {
    const platform = new ClaudePlatform();
    await platform.installHooks(repoDir);

    expect(ui.info).toHaveBeenCalledWith(
      expect.stringContaining(globalConfigPath()),
    );
    expect(ui.info).toHaveBeenCalledWith(
      expect.stringContaining('"mcpServers"'),
    );
  });

  it("never prompts for confirmation", async () => {
    const platform = new ClaudePlatform();
    await platform.installHooks(repoDir);

    expect(ui.askConfirm).not.toHaveBeenCalled();
  });
});

// IFCE-002: `uninstallHooks` must never read or write Claude Desktop's own (machine-global)
// config file either — even when it already exists with a Docuvia entry present. It must only
// clean up the repo-scoped `.claude/hooks/` directory and print an informational reminder
// telling the user to remove the entry manually.
describe("ClaudePlatform.uninstallHooks — no machine-global writes (IFCE-002)", () => {
  let repoDir: string;
  let globalConfigDir: string;
  let restoreGlobalConfigEnv: () => void;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "docuvia-claude-platform-repo-"),
    );
    globalConfigDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "docuvia-claude-platform-global-"),
    );
    restoreGlobalConfigEnv = redirectGlobalConfigEnv(globalConfigDir);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    restoreGlobalConfigEnv();
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.rm(globalConfigDir, { recursive: true, force: true });
  });

  function globalConfigPath(): string {
    // Mirror resolveClaudeDesktopConfigDir()'s platform subdir before the config filename.
    return globalConfigPathFor(globalConfigDir);
  }

  const fakeGlobalConfig = {
    mcpServers: {
      "docuvia-local": {
        command: "npx",
        args: ["-y", "docuvia", "mcp"],
      },
    },
  };

  async function seedGlobalConfig(): Promise<void> {
    await fs.mkdir(path.dirname(globalConfigPath()), { recursive: true });
    await fs.writeFile(
      globalConfigPath(),
      JSON.stringify(fakeGlobalConfig, null, 2),
    );
  }

  it("never modifies Claude Desktop's global config file, even when a Docuvia entry pre-exists", async () => {
    await seedGlobalConfig();
    const before = await fs.readFile(globalConfigPath(), "utf-8");

    const platform = new ClaudePlatform();
    await platform.uninstallHooks(repoDir);

    const after = await fs.readFile(globalConfigPath(), "utf-8");
    expect(after).toBe(before);
  });

  it("prints an informational reminder naming the global config path instead of editing it", async () => {
    await seedGlobalConfig();

    const platform = new ClaudePlatform();
    await platform.uninstallHooks(repoDir);

    expect(ui.info).toHaveBeenCalledWith(
      expect.stringContaining(globalConfigPath()),
    );
  });

  it("never prompts for confirmation", async () => {
    await seedGlobalConfig();

    const platform = new ClaudePlatform();
    await platform.uninstallHooks(repoDir);

    expect(ui.askConfirm).not.toHaveBeenCalled();
  });
});
