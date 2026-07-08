import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanCommand } from "../../../src/commands/clean.js";
import { ui } from "../../../src/ui/wizard.js";
import process from "process";
import { DI_TOKENS, container } from "@workspace/core";

const mockClean = vi.fn();
container.register(DI_TOKENS.CleanService, { clean: mockClean });

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    warn: vi.fn(),
    askConfirm: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
  },
}));

describe("cleanCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    mockClean.mockReset();
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully clean the workspace", async () => {
    mockClean.mockResolvedValue({ message: "Cleaned" });

    await cleanCommand();

    expect(mockClean).toHaveBeenCalled();
  });
});
