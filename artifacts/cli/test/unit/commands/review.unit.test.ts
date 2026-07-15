import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { reviewCommand } from "../../../src/commands/review.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { review: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
    })),
  },
}));

const mockReview = vi.mocked(docuviaApi.review);

describe("reviewCommand", () => {
  beforeEach(() => {
    mockReview.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    vi.mocked(ui.warn).mockReset();
    vi.mocked(ui.error).mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prints the risk level and analysis summary on success", async () => {
    mockReview.mockResolvedValue({
      baseRef: "main",
      filesChanged: [{ file: "src/a.ts", status: "modified" }],
      affectedNodes: [],
      riskLevel: "LOW",
      analysis: "Base: main\nFiles changed: 1\nRisk level: LOW",
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reviewCommand("main");

    expect(mockReview).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalled();
    // Closes docs/cli-test-analysis/review.md #1 — "Files changed: N" was previously unasserted.
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Files changed: 1"),
    );
    logSpy.mockRestore();
  });

  it("uses ui.error for a CRITICAL risk level and deletes the memory scope even on failure", async () => {
    mockReview.mockRejectedValue(
      new Error('Local database not found. Please run "docuvia init".'),
    );
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await reviewCommand();

    expect(spinnerFail).toHaveBeenCalledWith(
      expect.stringContaining("docuvia init"),
    );
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
});
