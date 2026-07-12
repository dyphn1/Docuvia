import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { syncKnowledgeCommand } from "../../../src/commands/sync-knowledge.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { syncKnowledge: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();
const spinnerWarn = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
      warn: spinnerWarn,
    })),
  },
}));

const mockSyncKnowledge = vi.mocked(docuviaApi.syncKnowledge);

describe("syncKnowledgeCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    mockSyncKnowledge.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    spinnerWarn.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("warns instead of succeeding when there's no remote to reconcile with", async () => {
    mockSyncKnowledge.mockResolvedValue({ status: "no-remote" });

    await syncKnowledgeCommand();

    expect(spinnerWarn).toHaveBeenCalled();
    expect(spinnerSucceed).not.toHaveBeenCalled();
  });

  it("reports success for a merge result", async () => {
    mockSyncKnowledge.mockResolvedValue({ status: "merged", branchTipSha: "merge-sha" });

    await syncKnowledgeCommand();

    expect(mockSyncKnowledge).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalledWith(expect.stringContaining("Merged"));
  });

  it("reports success for an up-to-date result", async () => {
    mockSyncKnowledge.mockResolvedValue({ status: "up-to-date", branchTipSha: "sha-1" });

    await syncKnowledgeCommand();

    expect(spinnerSucceed).toHaveBeenCalledWith(expect.stringContaining("up to date"));
  });

  it("calls spinner.fail and still deletes the memory scope when docuviaApi.syncKnowledge() throws", async () => {
    mockSyncKnowledge.mockRejectedValue(new Error("lock timeout"));
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await expect(syncKnowledgeCommand()).rejects.toThrow("Exit 1");

    expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("lock timeout"));
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
  });
});
