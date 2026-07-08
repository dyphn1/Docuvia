import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { statusCommand } from "../../../src/commands/status.js";
import { StatusService } from "@workspace/core";
import process from "process";

vi.mock("@workspace/core", () => {
  return {
    StatusService: vi.fn().mockImplementation(() => ({
      getStatus: vi.fn().mockResolvedValue({
        projects: 1,
        l2Nodes: 2,
        l3Nodes: 5,
      }),
    })),
  };
});

describe("statusCommand", () => {
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

  it("should successfully get status", async () => {
    await statusCommand();

    expect(StatusService).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("=== Docuvia Index Status ===");
  });

  it("should handle status failure", async () => {
    vi.mocked(StatusService).mockImplementationOnce(
      () =>
        ({
          getStatus: vi.fn().mockRejectedValue(new Error("Status failed")),
        }) as any
    );

    await expect(statusCommand()).rejects.toThrow("Exit 1");
  });
});
