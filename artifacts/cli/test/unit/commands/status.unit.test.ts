import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { statusCommand } from "../../../src/commands/status.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { status: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();

// header/info are referenced eagerly (as direct object properties, evaluated when the mocked
// module is first imported — before any later top-level `const` in this file has initialized),
// so they must be inline `vi.fn()` here. Only closures (like `spinner`'s returned object) can
// safely reference outer consts, since those aren't evaluated until called later. Assert on
// `ui.info`/`ui.header` directly instead of a separately-named const.
vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
    })),
  },
}));

const mockStatus = vi.mocked(docuviaApi.status);

describe("statusCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    mockStatus.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    vi.mocked(ui.info).mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prints project/l2/l3 counts on success", async () => {
    mockStatus.mockResolvedValue({ projects: 1, l2Nodes: 5, l3Nodes: 12 });

    await statusCommand();

    expect(spinnerSucceed).toHaveBeenCalled();
    expect(ui.header).toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("1"));
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("5"));
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("12"));
  });

  it("calls spinner.fail and still deletes the memory scope when docuviaApi.status() throws", async () => {
    mockStatus.mockRejectedValue(
      new Error('Local database not found. Please run "docuvia init".'),
    );
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await statusCommand();

    expect(spinnerFail).toHaveBeenCalledWith(
      expect.stringContaining("docuvia init"),
    );
    // Regression guard: process.exit() terminates the process before a pending `finally` runs,
    // which would silently skip docuviaMemory.deleteScope() — this was a real, previously
    // unfixed bug (see docs/cli-test-analysis/README.md's "Bugs found during verification" #1).
    // Must use process.exitCode instead.
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
  });
});
