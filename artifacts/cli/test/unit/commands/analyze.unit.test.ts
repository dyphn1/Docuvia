import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaApi } from "@workspace/ui-core";
import { analyzeCommand } from "../../../src/commands/analyze.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { analyze: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();

// header/info/error are referenced eagerly (as direct object properties, evaluated when the
// mocked module is first imported — before any later top-level `const` in this file has
// initialized), so they must be inline `vi.fn()` here; assert on `ui.info`/`ui.error` directly.
// Only closures (like `spinner`'s returned object) can safely reference outer consts.
vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
    })),
  },
}));

const mockAnalyze = vi.mocked(docuviaApi.analyze);

describe("analyzeCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    mockAnalyze.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    vi.mocked(ui.info).mockReset();
    vi.mocked(ui.error).mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prints projectType/suggestedTags on success when no target path is given", async () => {
    mockAnalyze.mockResolvedValue({ projectType: "typescript", suggestedTags: ["typescript", "react"] });

    await analyzeCommand();

    expect(mockAnalyze).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("typescript"));
  });

  it('prints a "not yet supported" message and does not call docuviaApi.analyze() when a target path is given', async () => {
    await analyzeCommand("src/foo.ts");

    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("not yet supported"));
    expect(process.exitCode).toBe(1);
  });

  it("calls spinner.fail when docuviaApi.analyze() throws", async () => {
    mockAnalyze.mockRejectedValue(new Error("boom"));

    await expect(analyzeCommand()).rejects.toThrow("Exit 1");

    expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});
