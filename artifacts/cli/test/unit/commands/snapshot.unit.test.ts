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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports node/edge/markdown counts on success", async () => {
    mockSnapshot.mockResolvedValue({ nodesWritten: 3, edgesWritten: 2, markdownFilesWritten: 3 });

    await snapshotCommand();

    expect(mockSnapshot).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalledWith(expect.stringContaining("3 nodes"));
    expect(spinnerSucceed).toHaveBeenCalledWith(expect.stringContaining("2 edges"));
  });

  it("calls spinner.fail and still deletes the memory scope when docuviaApi.snapshot() throws", async () => {
    mockSnapshot.mockRejectedValue(new Error('Local database not found. Please run "docuvia init".'));
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await expect(snapshotCommand()).rejects.toThrow("Exit 1");

    expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("docuvia init"));
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
  });
});
