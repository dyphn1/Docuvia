import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import process from "process";
import { docuviaMemory, MemoryKeys } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { syncKnowledgeCommand } from "../../../src/commands/sync-knowledge.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { syncKnowledge: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();
const spinnerWarn = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
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
    process.exitCode = undefined;
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
    mockSyncKnowledge.mockResolvedValue({
      status: "merged",
      branchTipSha: "merge-sha",
    });

    await syncKnowledgeCommand();

    expect(mockSyncKnowledge).toHaveBeenCalled();
    expect(ui.header).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalledWith(
      expect.stringContaining("Merged"),
    );
  });

  it("reports success for an up-to-date result", async () => {
    mockSyncKnowledge.mockResolvedValue({
      status: "up-to-date",
      branchTipSha: "sha-1",
    });

    await syncKnowledgeCommand();

    expect(spinnerSucceed).toHaveBeenCalledWith(
      expect.stringContaining("up to date"),
    );
  });

  it("reports success for a fast-forwarded-local result", async () => {
    mockSyncKnowledge.mockResolvedValue({
      status: "fast-forwarded-local",
      branchTipSha: "sha-2",
    });

    await syncKnowledgeCommand();

    expect(spinnerSucceed).toHaveBeenCalled();
    expect(spinnerFail).not.toHaveBeenCalled();
  });

  it("reports success for a pushed-local result", async () => {
    mockSyncKnowledge.mockResolvedValue({
      status: "pushed-local",
      branchTipSha: "sha-3",
    });

    await syncKnowledgeCommand();

    expect(spinnerSucceed).toHaveBeenCalled();
    expect(spinnerFail).not.toHaveBeenCalled();
  });

  it("reads DOCUVIA_PUSH_TIMEOUT_MS into docuviaMemory so syncKnowledge can thread it down to the git push/fetch bound; leaves it unset (no timeout) when the env var isn't set", async () => {
    let capturedWithEnvSet: number | undefined;
    mockSyncKnowledge.mockImplementationOnce(async (scopeId: string) => {
      capturedWithEnvSet = docuviaMemory.get<number>(
        scopeId,
        MemoryKeys.GIT_NETWORK_TIMEOUT_MS,
      );
      return { status: "no-remote" };
    });
    process.env.DOCUVIA_PUSH_TIMEOUT_MS = "120000";
    await syncKnowledgeCommand();
    delete process.env.DOCUVIA_PUSH_TIMEOUT_MS;
    expect(capturedWithEnvSet).toBe(120000);

    let capturedWithoutEnv: number | undefined;
    mockSyncKnowledge.mockImplementationOnce(async (scopeId: string) => {
      capturedWithoutEnv = docuviaMemory.get<number>(
        scopeId,
        MemoryKeys.GIT_NETWORK_TIMEOUT_MS,
      );
      return { status: "no-remote" };
    });
    await syncKnowledgeCommand();
    expect(capturedWithoutEnv).toBeUndefined();
  });

  it("calls spinner.fail and still deletes the memory scope when docuviaApi.syncKnowledge() throws", async () => {
    mockSyncKnowledge.mockRejectedValue(new Error("lock timeout"));
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await syncKnowledgeCommand();

    expect(spinnerFail).toHaveBeenCalledWith(
      expect.stringContaining("lock timeout"),
    );
    // Regression guard: process.exit() terminates the process before a pending `finally` runs,
    // which would silently skip docuviaMemory.deleteScope() — see docs/cli-test-analysis/
    // README.md's "Bugs found during verification" #1. Must use process.exitCode instead.
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
  });
});
