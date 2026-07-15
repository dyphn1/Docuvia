import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { snapshotCommand } from "../../../src/commands/snapshot.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { snapshot: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
    })),
  },
}));

const mockSnapshot = vi.mocked(docuviaApi.snapshot);

describe("snapshotCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    mockSnapshot.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports node/edge/markdown counts on success", async () => {
    mockSnapshot.mockResolvedValue({
      nodesWritten: 3,
      edgesWritten: 2,
      markdownFilesWritten: 3,
    });

    await snapshotCommand();

    expect(mockSnapshot).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalledWith(
      expect.stringContaining("3 nodes"),
    );
    expect(spinnerSucceed).toHaveBeenCalledWith(
      expect.stringContaining("2 edges"),
    );
  });

  it("updates spinner.text as the workflow logger emits info events", async () => {
    // Closes docs/cli-test-analysis/snapshot.md #1 — the logger.onLog -> spinner.text wiring
    // (snapshot.ts) was previously never exercised by a test.
    mockSnapshot.mockImplementation(async (_scopeId, logger) => {
      logger.info("Rendering markdown files...");
      return { nodesWritten: 3, edgesWritten: 2, markdownFilesWritten: 3 };
    });

    await snapshotCommand();

    const spinnerInstance = vi.mocked(ui.spinner).mock.results[0].value;
    expect(spinnerInstance.text).toBe("Rendering markdown files...");
  });

  it("calls spinner.fail and still deletes the memory scope when docuviaApi.snapshot() throws", async () => {
    mockSnapshot.mockRejectedValue(
      new Error('Local database not found. Please run "docuvia init".'),
    );
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await snapshotCommand();

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
