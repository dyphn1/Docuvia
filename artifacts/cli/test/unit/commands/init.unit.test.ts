import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { initCommand } from "../../../src/commands/init.js";
import { ui } from "../../../src/ui/wizard.js";
import {
  CursorPlatform,
  ClaudePlatform,
  GenericMarkdownPlatform,
} from "../../../src/platforms/index.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { init: vi.fn() },
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
    askConfirm: vi.fn(),
    askCheckbox: vi
      .fn()
      .mockResolvedValue(["Cursor", "Claude", "Markdown Agents"]),
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      warn: spinnerWarn,
      fail: spinnerFail,
    })),
  },
}));

// Mock the platforms so they don't actually write files
vi.mock("../../../src/platforms/index.js", () => {
  return {
    CursorPlatform: vi.fn().mockImplementation(() => ({
      name: "Cursor",
      slug: "cursor",
      installHooks: vi.fn(),
      uninstallHooks: vi.fn(),
    })),
    ClaudePlatform: vi.fn().mockImplementation(() => ({
      name: "Claude",
      slug: "claude",
      installHooks: vi.fn(),
      uninstallHooks: vi.fn(),
    })),
    GenericMarkdownPlatform: vi.fn().mockImplementation(() => ({
      name: "Markdown Agents",
      slug: "markdown",
      installHooks: vi.fn(),
      uninstallHooks: vi.fn(),
    })),
  };
});

const mockInit = vi.mocked(docuviaApi.init);

describe("initCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    mockInit.mockReset();
    spinnerSucceed.mockReset();
    spinnerWarn.mockReset();
    spinnerFail.mockReset();
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize docuvia non-interactively via docuviaApi.init, scoping memory to a fresh UUID and cleaning it up afterwards", async () => {
    mockInit.mockImplementation(async (scopeId) => {
      // Assert the CLI already injected workspaceRoot before calling the Orchestration layer.
      expect(docuviaMemory.get(scopeId, "workspaceRoot")).toEqual(
        expect.any(String),
      );
      return {
        success: true,
        partialFailure: false,
        message: "Success",
      } as any;
    });
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await initCommand();

    expect(mockInit).toHaveBeenCalled();
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
  });

  it("should proceed if confirmed in TTY", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    vi.mocked(ui.askConfirm).mockResolvedValue(true);
    mockInit.mockResolvedValue({
      success: true,
      partialFailure: false,
      message: "Success",
    } as any);

    await initCommand();

    expect(ui.askConfirm).toHaveBeenCalled();
    expect(mockInit).toHaveBeenCalled();
  });

  it("calls spinner.succeed with the success message when partialFailure is false", async () => {
    mockInit.mockResolvedValue({
      success: true,
      partialFailure: false,
      message: "Project initialized successfully",
    } as any);

    await initCommand();

    expect(spinnerSucceed).toHaveBeenCalledWith(
      "Project initialized successfully",
    );
    expect(spinnerWarn).not.toHaveBeenCalled();
  });

  // Audit reproduction: 13 of 4236 files failed to parse in the real run this fix addresses.
  // This unit test uses a small mocked count, but exercises the exact same branch.
  it("calls spinner.warn (not succeed) with a message containing the failure count when partialFailure is true", async () => {
    mockInit.mockResolvedValue({
      success: true,
      partialFailure: true,
      filesRequested: 4236,
      filesParsed: 4223,
      filesFailed: 13,
      message:
        "Project initialized — 13 of 4236 files failed to parse (see .docuvia/logs/init.log)",
    } as any);

    await initCommand();

    expect(spinnerWarn).toHaveBeenCalledWith(expect.stringContaining("13"));
    expect(spinnerSucceed).not.toHaveBeenCalled();
  });

  it("calls spinner.fail and still deletes the memory scope when docuviaApi.init() throws", async () => {
    mockInit.mockRejectedValue(new Error("boom"));
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await expect(initCommand()).rejects.toThrow("Exit 1");

    expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
  });

  describe("--global threading to platform.installHooks", () => {
    it("passes allowGlobalMcpConfig=true through to every platform's configure() when the --global flag was set", async () => {
      mockInit.mockResolvedValue({
        success: true,
        partialFailure: false,
        message: "Success",
      } as any);

      await initCommand(process.cwd(), true);

      const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
      const cursorInstance = vi.mocked(CursorPlatform).mock.results[0].value;
      const markdownInstance = vi.mocked(GenericMarkdownPlatform).mock
        .results[0].value;

      expect(claudeInstance.installHooks).toHaveBeenCalledWith(
        process.cwd(),
        true,
      );
      expect(cursorInstance.installHooks).toHaveBeenCalledWith(
        process.cwd(),
        true,
      );
      expect(markdownInstance.installHooks).toHaveBeenCalledWith(
        process.cwd(),
        true,
      );
    });

    it("passes allowGlobalMcpConfig=false through to platform.installHooks() by default (--global absent)", async () => {
      mockInit.mockResolvedValue({
        success: true,
        partialFailure: false,
        message: "Success",
      } as any);

      await initCommand(process.cwd());

      const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
      expect(claudeInstance.installHooks).toHaveBeenCalledWith(
        process.cwd(),
        false,
      );
    });
  });

  describe("--platform selection", () => {
    it("installs only the platforms named in the --platform flag, skipping the interactive checkbox", async () => {
      mockInit.mockResolvedValue({
        success: true,
        partialFailure: false,
        message: "Success",
      } as any);

      await initCommand(process.cwd(), false, "claude,cursor");

      expect(ui.askCheckbox).not.toHaveBeenCalled();

      const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
      const cursorInstance = vi.mocked(CursorPlatform).mock.results[0].value;
      const markdownInstance = vi.mocked(GenericMarkdownPlatform).mock
        .results[0].value;

      expect(claudeInstance.installHooks).toHaveBeenCalled();
      expect(cursorInstance.installHooks).toHaveBeenCalled();
      expect(markdownInstance.installHooks).not.toHaveBeenCalled();
    });

    it("is case-insensitive and tolerates surrounding whitespace", async () => {
      mockInit.mockResolvedValue({
        success: true,
        partialFailure: false,
        message: "Success",
      } as any);

      await initCommand(process.cwd(), false, " Claude , CURSOR ");

      const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
      const cursorInstance = vi.mocked(CursorPlatform).mock.results[0].value;
      const markdownInstance = vi.mocked(GenericMarkdownPlatform).mock
        .results[0].value;

      expect(claudeInstance.installHooks).toHaveBeenCalled();
      expect(cursorInstance.installHooks).toHaveBeenCalled();
      expect(markdownInstance.installHooks).not.toHaveBeenCalled();
    });

    it("reports an error and exits when an unknown platform slug is given", async () => {
      mockInit.mockResolvedValue({
        success: true,
        partialFailure: false,
        message: "Success",
      } as any);

      await expect(
        initCommand(process.cwd(), false, "notaplatform"),
      ).rejects.toThrow("Exit 1");

      expect(ui.error).toHaveBeenCalledWith(
        expect.stringContaining("Unknown --platform value"),
      );
    });

    it("installs every platform when --platform is omitted (default behavior preserved)", async () => {
      mockInit.mockResolvedValue({
        success: true,
        partialFailure: false,
        message: "Success",
      } as any);

      await initCommand(process.cwd());

      const claudeInstance = vi.mocked(ClaudePlatform).mock.results[0].value;
      const cursorInstance = vi.mocked(CursorPlatform).mock.results[0].value;
      const markdownInstance = vi.mocked(GenericMarkdownPlatform).mock
        .results[0].value;

      expect(claudeInstance.installHooks).toHaveBeenCalled();
      expect(cursorInstance.installHooks).toHaveBeenCalled();
      expect(markdownInstance.installHooks).toHaveBeenCalled();
    });
  });
});
