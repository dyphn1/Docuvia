import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reviewCommand } from "../../../src/commands/review.js";
import { ui } from "../../../src/ui/wizard.js";
import process from "process";
import { DI_TOKENS, DI_KEYS, container } from "@workspace/core";

const mockReview = vi.fn();
container.register(DI_TOKENS.ChangeDetectionService, { detectChanges: mockReview });

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
  },
}));

describe("reviewCommand", () => {
  let exitSpy: any;
  let logSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockReview.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully review", async () => {
    mockReview.mockResolvedValue({ analysis: "Looks good" });

    await reviewCommand();

    expect(mockReview).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("Looks good");
  });
});
