import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { uninstallCommand } from "../../../src/commands/uninstall.js";
import { ui } from "../../../src/ui/wizard.js";
import {
  CursorPlatform,
  ClaudePlatform,
  CopilotPlatform,
} from "../../../src/platforms/index.js";
import { removeBlock } from "../../../src/utils/fs-utils.js";

vi.mock("../../../src/utils/fs-utils.js", () => ({
  removeBlock: vi.fn().mockResolvedValue(false),
}));

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: {
    clean: vi.fn(),
    uninstallGitHooks: vi.fn().mockResolvedValue({
      postCommitRemoved: true,
      prePushRemoved: true,
      knowledgeBranchDeleted: true,
    }),
    removeDocuviaDir: vi.fn().mockResolvedValue({ removed: true }),
  },
}));

const spinnerSucceed = vi.fn();
const spinnerWarn = vi.fn();
const spinnerFail = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      warn: spinnerWarn,
      fail: spinnerFail,
    })),
  },
}));

vi.mock("../../../src/platforms/index.js", () => {
  return {
    CursorPlatform: vi.fn().mockImplementation(() => ({
      name: "Cursor",
      slug: "cursor",
      uninstallHooks: vi.fn(),
    })),
    ClaudePlatform: vi.fn().mockImplementation(() => ({
      name: "Claude",
      slug: "claude",
      uninstallHooks: vi.fn(),
    })),
    CopilotPlatform: vi.fn().mockImplementation(() => ({
      name: "GitHub Copilot",
      slug: "copilot",
      uninstallHooks: vi.fn(),
    })),
    CodexPlatform: vi.fn().mockImplementation(() => ({
      name: "Codex",
      slug: "codex",
      uninstallHooks: vi.fn(),
    })),
    ContinuePlatform: vi.fn().mockImplementation(() => ({
      name: "Continue",
      slug: "continue",
      uninstallHooks: vi.fn(),
    })),
    HermesPlatform: vi.fn().mockImplementation(() => ({
      name: "Hermes Agent",
      slug: "hermes",
      uninstallHooks: vi.fn(),
    })),
  };
});

const mockClean = vi.mocked(docuviaApi.clean);
const mockUninstallGitHooks = vi.mocked(docuviaApi.uninstallGitHooks);
const mockRemoveDocuviaDir = vi.mocked(docuviaApi.removeDocuviaDir);

describe("uninstallCommand", () => {
  beforeEach(() => {
    mockClean.mockReset();
    mockUninstallGitHooks.mockReset();
    mockUninstallGitHooks.mockResolvedValue({
      postCommitRemoved: true,
      prePushRemoved: true,
      knowledgeBranchDeleted: true,
    });
    mockRemoveDocuviaDir.mockReset();
    mockRemoveDocuviaDir.mockResolvedValue({ removed: true });
    spinnerSucceed.mockReset();
    spinnerWarn.mockReset();
    spinnerFail.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should uninstall docuvia integrations via uninstallHooks and clean database", async () => {
    mockClean.mockImplementation(async (scopeId) => {
      expect(docuviaMemory.get(scopeId, "workspaceRoot")).toEqual(
        expect.any(String),
      );
      return {
        success: true,
        partialFailure: false,
        message: "Cleaned",
      } as any;
    });
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await uninstallCommand(process.cwd());

    expect(mockClean).toHaveBeenCalled();
    // 3, not 1: one scope for the git-hooks-removal step, one for the db cleanup step, one for
    // the .docuvia/ directory removal step.
    expect(deleteScopeSpy).toHaveBeenCalledTimes(3);

    const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
    const cursorInstance = vi.mocked(CursorPlatform).mock.results[0].value;
    const copilotInstance = vi.mocked(CopilotPlatform).mock.results[0].value;

    expect(claudeInstance.uninstallHooks).toHaveBeenCalledWith(process.cwd());
    expect(cursorInstance.uninstallHooks).toHaveBeenCalledWith(process.cwd());
    expect(copilotInstance.uninstallHooks).toHaveBeenCalledWith(process.cwd());
    expect(mockUninstallGitHooks).toHaveBeenCalled();
    // PLAT-008: legacy markdown-block cleanup always runs, independent of platform selection.
    expect(removeBlock).toHaveBeenCalled();
    // Full uninstall (no --keep-db): both the knowledge branch and the .docuvia/ dir go too.
    expect(ui.success).toHaveBeenCalledWith(
      expect.stringContaining("docuvia-knowledge"),
    );
    expect(mockRemoveDocuviaDir).toHaveBeenCalled();
    expect(ui.success).toHaveBeenCalledWith(
      expect.stringContaining(".docuvia/"),
    );
  });

  it("surfaces a git-hooks-removal failure in the existing partial-failure path", async () => {
    mockClean.mockResolvedValue({
      success: true,
      partialFailure: false,
      message: "Cleaned",
    } as any);
    mockUninstallGitHooks.mockRejectedValue(new Error("EACCES"));

    await uninstallCommand(process.cwd());

    expect(mockClean).toHaveBeenCalled();
    expect(ui.warn).toHaveBeenCalledWith(
      expect.stringContaining("git hooks removal"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode to 1 on failure", async () => {
    mockClean.mockRejectedValue(new Error("boom"));
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await uninstallCommand(process.cwd());

    expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("boom"));
    // 3, not 1: one scope for the git-hooks-removal step, one for the db cleanup step (whose
    // failure this test exercises), one for the .docuvia/ directory removal step.
    expect(deleteScopeSpy).toHaveBeenCalledTimes(3);
    expect(process.exitCode).toBe(1);
  });

  it("rejects an empty workspaceRoot before touching any platform or docuviaApi.clean", async () => {
    await uninstallCommand("");

    expect(ui.error).toHaveBeenCalledWith(
      expect.stringContaining("must not be empty"),
    );
    expect(process.exitCode).toBe(1);
    expect(mockClean).not.toHaveBeenCalled();
    expect(ClaudePlatform).not.toHaveBeenCalled();
  });

  it("still uninstalls the remaining platforms and still cleans the database when one platform's uninstallHooks throws", async () => {
    mockClean.mockResolvedValue({
      success: true,
      partialFailure: false,
      message: "Cleaned",
    } as any);
    vi.mocked(ClaudePlatform).mockImplementationOnce(
      () =>
        ({
          name: "Claude",
          slug: "claude",
          uninstallHooks: vi
            .fn()
            .mockRejectedValue(new Error("EPERM: hook file locked")),
        }) as any,
    );

    await uninstallCommand(process.cwd());

    const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
    const cursorInstance = vi.mocked(CursorPlatform).mock.results[0].value;
    const copilotInstance = vi.mocked(CopilotPlatform).mock.results[0].value;

    // The throwing platform is still attempted, and so are the others after it — previously a
    // single platform's throw propagated straight to the outer catch, silently skipping both the
    // remaining platforms in the loop and the database cleanup step below.
    expect(claudeInstance.uninstallHooks).toHaveBeenCalled();
    expect(cursorInstance.uninstallHooks).toHaveBeenCalled();
    expect(copilotInstance.uninstallHooks).toHaveBeenCalled();
    expect(mockClean).toHaveBeenCalled();
    expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Claude"));
    expect(process.exitCode).toBe(1);
  });

  describe("--platform selection", () => {
    it("uninstalls only the platforms named in the --platform flag", async () => {
      mockClean.mockResolvedValue({
        success: true,
        partialFailure: false,
        message: "Cleaned",
      } as any);

      await uninstallCommand(process.cwd(), "copilot");

      const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
      const cursorInstance = vi.mocked(CursorPlatform).mock.results[0].value;
      const copilotInstance = vi.mocked(CopilotPlatform).mock.results[0].value;

      expect(claudeInstance.uninstallHooks).not.toHaveBeenCalled();
      expect(cursorInstance.uninstallHooks).not.toHaveBeenCalled();
      expect(copilotInstance.uninstallHooks).toHaveBeenCalledWith(
        process.cwd(),
      );
    });

    it("reports an error and sets exitCode to 1 for an unknown platform slug", async () => {
      await uninstallCommand(process.cwd(), "notaplatform");

      expect(ui.warn).toHaveBeenCalledWith(
        expect.stringContaining("Unknown --platform value"),
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe("--keep-db", () => {
    it("skips database cleanup when keepDb is true", async () => {
      await uninstallCommand(process.cwd(), undefined, true);

      expect(mockClean).not.toHaveBeenCalled();
      expect(ui.info).toHaveBeenCalledWith(
        expect.stringContaining("--keep-db"),
      );

      const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
      expect(claudeInstance.uninstallHooks).toHaveBeenCalledWith(process.cwd());
    });

    it("also keeps the .docuvia/ directory and the knowledge branch when keepDb is true", async () => {
      let capturedKeepDb: boolean | undefined;
      mockUninstallGitHooks.mockImplementation(async (scopeId) => {
        capturedKeepDb = docuviaMemory.get(scopeId, "keepDb");
        return {
          postCommitRemoved: true,
          prePushRemoved: true,
          knowledgeBranchDeleted: false,
        };
      });

      await uninstallCommand(process.cwd(), undefined, true);

      expect(mockRemoveDocuviaDir).not.toHaveBeenCalled();
      expect(capturedKeepDb).toBe(true);
    });

    it("still cleans the database by default (keepDb absent)", async () => {
      mockClean.mockResolvedValue({
        success: true,
        partialFailure: false,
        message: "Cleaned",
      } as any);

      await uninstallCommand(process.cwd());

      expect(mockClean).toHaveBeenCalled();
    });
  });
});
