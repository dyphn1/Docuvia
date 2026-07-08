import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initCommand } from "../../../src/commands/init.js";
import { ui } from "../../../src/ui/wizard.js";
import { InitService } from "@workspace/core";
import process from "process";

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    header: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
    askConfirm: vi.fn(),
  },
}));

vi.mock("@workspace/core", () => {
  return {
    InitService: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue({ message: "Initialized successfully" }),
    })),
  };
});

describe("initCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code) => {
      throw new Error(`Exit ${code}`);
    }) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize docuvia non-interactively", async () => {
    // @ts-ignore
    process.stdin.isTTY = false;
    await initCommand();

    expect(InitService).toHaveBeenCalled();
  });

  it("should abort if not confirmed in TTY", async () => {
    // @ts-ignore
    process.stdin.isTTY = true;
    vi.mocked(ui.askConfirm).mockResolvedValueOnce(false);

    await expect(initCommand()).rejects.toThrow("Exit 0");

    expect(ui.warn).toHaveBeenCalledWith("Initialization aborted.");
    expect(InitService).not.toHaveBeenCalled();
  });

  it("should proceed if confirmed in TTY", async () => {
    // @ts-ignore
    process.stdin.isTTY = true;
    vi.mocked(ui.askConfirm).mockResolvedValueOnce(true);

    await initCommand();

    expect(InitService).toHaveBeenCalled();
  });

  it("should handle initialization failure", async () => {
    // @ts-ignore
    process.stdin.isTTY = false;
    vi.mocked(InitService).mockImplementationOnce(
      () =>
        ({
          init: vi.fn().mockRejectedValue(new Error("Init failed")),
        }) as any
    );

    await expect(initCommand()).rejects.toThrow("Exit 1");
  });
});
