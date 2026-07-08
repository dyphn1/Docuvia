import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanCommand } from "../../../src/commands/clean.js";
import { CleanService } from "@workspace/core";
import process from "process";

vi.mock("@workspace/core", () => {
  return {
    CleanService: vi.fn().mockImplementation(() => ({
      clean: vi.fn().mockResolvedValue({ deleted: true }),
    })),
  };
});

describe("cleanCommand", () => {
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

  it("should successfully clean the workspace", async () => {
    await cleanCommand();

    expect(CleanService).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("Cleaned .docuvia/local.db database.");
  });

  it("should handle clean failure", async () => {
    vi.mocked(CleanService).mockImplementationOnce(
      () =>
        ({
          clean: vi.fn().mockRejectedValue(new Error("Clean failed")),
        }) as any
    );

    await expect(cleanCommand()).rejects.toThrow("Exit 1");
  });
});
