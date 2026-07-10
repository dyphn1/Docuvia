import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initCommand } from "../../../src/commands/init.js";
import { ui } from "../../../src/ui/wizard.js";
import process from "process";
import { DI_TOKENS, DI_KEYS, container } from "@workspace/core";
import {
  CursorPlatform,
  ClaudePlatform,
  GenericMarkdownPlatform,
} from "../../../src/platforms/index.js";

const mockInit = vi.fn();
container.register(DI_TOKENS.InitService, { init: mockInit });

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
    askCheckbox: vi.fn().mockResolvedValue(["Cursor", "Claude", "Markdown Agents"]),
    spinner: vi.fn(() => ({
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
    CursorPlatform: vi.fn().mockImplementation(() => ({ name: "Cursor", configure: vi.fn() })),
    ClaudePlatform: vi.fn().mockImplementation(() => ({ name: "Claude", configure: vi.fn() })),
    GenericMarkdownPlatform: vi
      .fn()
      .mockImplementation(() => ({ name: "Markdown Agents", configure: vi.fn() })),
  };
});

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
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize docuvia non-interactively", async () => {
    mockInit.mockResolvedValue({ message: "Success" });

    await initCommand();

    expect(mockInit).toHaveBeenCalled();
  });

  it("should proceed if confirmed in TTY", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    vi.mocked(ui.askConfirm).mockResolvedValue(true);
    mockInit.mockResolvedValue({ message: "Success" });

    await initCommand();

    expect(ui.askConfirm).toHaveBeenCalled();
    expect(mockInit).toHaveBeenCalled();
  });

  it("calls spinner.succeed with the success message when partialFailure is false", async () => {
    mockInit.mockResolvedValue({
      success: true,
      partialFailure: false,
      message: "Project initialized successfully",
    });

    await initCommand();

    expect(spinnerSucceed).toHaveBeenCalledWith("Project initialized successfully");
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
    });

    await initCommand();

    expect(spinnerWarn).toHaveBeenCalledWith(expect.stringContaining("13"));
    expect(spinnerSucceed).not.toHaveBeenCalled();
  });
});
