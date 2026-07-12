import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { uninstallCommand } from "../../../src/commands/uninstall.js";
import { ui } from "../../../src/ui/wizard.js";
import {
  CursorPlatform,
  ClaudePlatform,
  GenericMarkdownPlatform,
} from "../../../src/platforms/index.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { clean: vi.fn() },
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
    GenericMarkdownPlatform: vi.fn().mockImplementation(() => ({
      name: "Markdown Agents",
      slug: "markdown",
      uninstallHooks: vi.fn(),
    })),
  };
});

const mockClean = vi.mocked(docuviaApi.clean);

describe("uninstallCommand", () => {
  beforeEach(() => {
    mockClean.mockReset();
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

    await uninstallCommand(process.cwd(), false);

    expect(mockClean).toHaveBeenCalled();
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);

    const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
    const cursorInstance = vi.mocked(CursorPlatform).mock.results[0].value;
    const markdownInstance = vi.mocked(GenericMarkdownPlatform).mock.results[0]
      .value;

    expect(claudeInstance.uninstallHooks).toHaveBeenCalledWith(
      process.cwd(),
      false,
    );
    expect(cursorInstance.uninstallHooks).toHaveBeenCalledWith(
      process.cwd(),
      false,
    );
    expect(markdownInstance.uninstallHooks).toHaveBeenCalledWith(
      process.cwd(),
      false,
    );
  });

  it("sets exitCode to 1 on failure", async () => {
    mockClean.mockRejectedValue(new Error("boom"));
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await uninstallCommand(process.cwd(), false);

    expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });

  describe("--platform selection", () => {
    it("uninstalls only the platforms named in the --platform flag", async () => {
      mockClean.mockResolvedValue({
        success: true,
        partialFailure: false,
        message: "Cleaned",
      } as any);

      await uninstallCommand(process.cwd(), false, "markdown");

      const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
      const cursorInstance = vi.mocked(CursorPlatform).mock.results[0].value;
      const markdownInstance = vi.mocked(GenericMarkdownPlatform).mock
        .results[0].value;

      expect(claudeInstance.uninstallHooks).not.toHaveBeenCalled();
      expect(cursorInstance.uninstallHooks).not.toHaveBeenCalled();
      expect(markdownInstance.uninstallHooks).toHaveBeenCalledWith(
        process.cwd(),
        false,
      );
    });

    it("reports an error and sets exitCode to 1 for an unknown platform slug", async () => {
      await uninstallCommand(process.cwd(), false, "notaplatform");

      expect(ui.warn).toHaveBeenCalledWith(
        expect.stringContaining("Unknown --platform value"),
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe("--keep-db", () => {
    it("skips database cleanup when keepDb is true", async () => {
      await uninstallCommand(process.cwd(), false, undefined, true);

      expect(mockClean).not.toHaveBeenCalled();
      expect(ui.info).toHaveBeenCalledWith(
        expect.stringContaining("--keep-db"),
      );

      const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
      expect(claudeInstance.uninstallHooks).toHaveBeenCalledWith(
        process.cwd(),
        false,
      );
    });

    it("still cleans the database by default (keepDb absent)", async () => {
      mockClean.mockResolvedValue({
        success: true,
        partialFailure: false,
        message: "Cleaned",
      } as any);

      await uninstallCommand(process.cwd(), false);

      expect(mockClean).toHaveBeenCalled();
    });
  });
});
