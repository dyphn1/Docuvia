import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initCommand } from "../../../src/commands/init.js";
import { ui } from "../../../src/ui/wizard.js";
import process from "process";
import { DI_TOKENS, container } from "@workspace/core";
import {
  CursorPlatform,
  ClaudePlatform,
  GenericMarkdownPlatform,
} from "../../../src/platforms/index.js";

const mockInit = vi.fn();
container.register(DI_TOKENS.InitService, { init: mockInit });

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
      succeed: vi.fn(),
      fail: vi.fn(),
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
});
