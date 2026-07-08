import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryCommand } from "../../../src/commands/query.js";
import { ui } from "../../../src/ui/wizard.js";
import { QueryService } from "@workspace/core";
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
      text: "",
    })),
    askInput: vi.fn(),
    askSelect: vi.fn(),
    askConfirm: vi.fn(),
  },
}));

vi.mock("@workspace/core", () => {
  return {
    QueryService: vi.fn().mockImplementation(() => ({
      query: vi.fn().mockResolvedValue({
        l2: { name: "Test Module" },
        l3: [{ title: "Test Decision", status: "Active", content: "Test content" }],
      }),
    })),
  };
});

describe("queryCommand", () => {
  let exitSpy: any;
  let consoleSpy: any;

  beforeEach(() => {
    // @ts-ignore
    process.stdin.isTTY = true;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should prompt for target if missing and in TTY", async () => {
    vi.mocked(ui.askInput).mockResolvedValueOnce("test-query");

    await queryCommand();

    expect(ui.askInput).toHaveBeenCalledWith("Enter search target (e.g., function name, concept):");
    expect(QueryService).toHaveBeenCalled();
  });

  it("should exit if no target provided in non-TTY", async () => {
    // @ts-ignore
    process.stdin.isTTY = false;

    await expect(queryCommand()).rejects.toThrow("Exit 1");

    expect(ui.error).toHaveBeenCalledWith("Missing required argument: <target>");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(QueryService).not.toHaveBeenCalled();
  });

  it("should format as prompt if options.format is prompt", async () => {
    await queryCommand("test-query", { format: "prompt" });

    expect(ui.askInput).not.toHaveBeenCalled();
    expect(QueryService).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("<docuvia_context>"));
  });

  it("should exit if prompted target is empty", async () => {
    vi.mocked(ui.askInput).mockResolvedValueOnce("");
    await expect(queryCommand()).rejects.toThrow("Exit 1");
    expect(ui.error).toHaveBeenCalledWith("Query target is required.");
  });

  it("should handle query failure with spinner", async () => {
    vi.mocked(QueryService).mockImplementationOnce(
      () =>
        ({
          query: vi.fn().mockRejectedValue(new Error("Search Failed")),
        }) as any
    );
    await expect(queryCommand("test")).rejects.toThrow("Exit 1");
  });

  it("should handle query failure without spinner (prompt format)", async () => {
    vi.mocked(QueryService).mockImplementationOnce(
      () =>
        ({
          query: vi.fn().mockRejectedValue(new Error("Search Failed")),
        }) as any
    );
    const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(queryCommand("test", { format: "prompt" })).rejects.toThrow("Exit 1");
    expect(consoleErrSpy).toHaveBeenCalledWith("Query Error:", "Search Failed");
  });

  it("should handle missing l2 results in human format", async () => {
    vi.mocked(QueryService).mockImplementationOnce(
      () =>
        ({
          query: vi.fn().mockResolvedValue({
            l3: [{ title: "L3 only", status: "Active" }],
          }),
        }) as any
    );
    await queryCommand("test");
    expect(ui.warn).toHaveBeenCalledWith("No matching L2 module found. Showing global results.");
  });
});
