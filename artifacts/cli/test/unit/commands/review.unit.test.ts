import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reviewCommand } from "../../../src/commands/review.js";
import { ChangeDetectionService } from "@workspace/core";
import process from "process";

vi.mock("@workspace/core", () => {
  return {
    ChangeDetectionService: vi.fn().mockImplementation(() => ({
      detectChanges: vi.fn().mockResolvedValue({ analysis: "Analysis result" }),
    })),
  };
});

describe("reviewCommand", () => {
  let exitSpy: any;
  let logSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully review", async () => {
    await reviewCommand();

    expect(ChangeDetectionService).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("Analysis result");
  });

  it("should handle review failure", async () => {
    vi.mocked(ChangeDetectionService).mockImplementationOnce(
      () =>
        ({
          detectChanges: vi.fn().mockRejectedValue(new Error("Review failed")),
        }) as any
    );

    await expect(reviewCommand()).rejects.toThrow("Exit 1");
  });
});
