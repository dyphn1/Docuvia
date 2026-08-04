import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { impactCommand } from "../../../src/commands/impact.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { impact: vi.fn() },
}));

const spinnerSucceed = vi.fn();
const spinnerFail = vi.fn();
const spinnerWarn = vi.fn();

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    table: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    spinner: vi.fn(() => ({
      text: "",
      start: vi.fn().mockReturnThis(),
      succeed: spinnerSucceed,
      fail: spinnerFail,
      warn: spinnerWarn,
    })),
  },
}));

const mockImpact = vi.mocked(docuviaApi.impact);

describe("impactCommand", () => {
  beforeEach(() => {
    mockImpact.mockReset();
    spinnerSucceed.mockReset();
    spinnerFail.mockReset();
    spinnerWarn.mockReset();
    vi.mocked(ui.warn).mockReset();
    vi.mocked(ui.error).mockReset();
    vi.mocked(ui.log).mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("errors immediately without calling docuviaApi.impact() when target is empty", async () => {
    await impactCommand("");

    expect(mockImpact).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("prints the blast radius as a Name/Type table and the risk level on success", async () => {
    mockImpact.mockResolvedValue({
      blastRadius: [{ name: "caller", type: "module" }],
      riskLevel: "MEDIUM",
    });

    await impactCommand("target");

    expect(mockImpact).toHaveBeenCalled();
    expect(spinnerSucceed).toHaveBeenCalled();
    // Closes docs/cli-test-analysis/impact.md #1 — the blast-radius rendering was previously
    // unasserted, so a broken table call here would have gone unnoticed.
    expect(ui.table).toHaveBeenCalledWith(expect.anything(), [
      ["caller", "module"],
    ]);
  });

  it("prints L3 'why' data for a blast-radius entry that carries it", async () => {
    mockImpact.mockResolvedValue({
      blastRadius: [
        {
          name: "caller",
          type: "module",
          why: [{ title: "why caller exists", content: "because reasons" }],
        },
      ],
      riskLevel: "MEDIUM",
    });

    await impactCommand("target");

    expect(ui.log).toHaveBeenCalledWith(
      expect.stringContaining("why caller exists"),
    );
    expect(ui.log).toHaveBeenCalledWith(
      expect.stringContaining("because reasons"),
    );
  });

  it("prints the Tier B incomplete-coverage warning under IMPACT_NO_DEPENDENTS when tierBCoverage is present and coverage is incomplete", async () => {
    mockImpact.mockResolvedValue({
      blastRadius: [],
      riskLevel: "LOW",
      tierBCoverage: {
        ownFileLastProcessedAt: "2026-01-01",
        workspaceFilesProcessed: 3,
        workspaceFilesTotal: 10,
      },
    });

    await impactCommand("target");

    expect(ui.warn).toHaveBeenCalledWith(
      expect.stringContaining("7 of 10 tracked file(s)"),
    );
    expect(ui.warn).toHaveBeenCalledWith(
      expect.stringContaining("--escalate-to-lsp --full"),
    );
  });

  it("does not print the Tier B incomplete-coverage warning when tierBCoverage is absent (today's exact output, regression guard)", async () => {
    mockImpact.mockResolvedValue({
      blastRadius: [],
      riskLevel: "LOW",
    });

    await impactCommand("target");

    expect(ui.warn).toHaveBeenCalledTimes(1);
    expect(ui.warn).toHaveBeenCalledWith(expect.not.stringContaining("Tier B"));
  });

  it("warns when no matching node is found (docuviaApi.impact() resolves null)", async () => {
    mockImpact.mockResolvedValue(null);

    await impactCommand("nope");

    expect(spinnerWarn).toHaveBeenCalled();
  });

  it("calls spinner.fail and deletes the memory scope when docuviaApi.impact() throws", async () => {
    mockImpact.mockRejectedValue(new Error("boom"));
    const deleteScopeSpy = vi.spyOn(docuviaMemory, "deleteScope");

    await impactCommand("target");

    expect(spinnerFail).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(deleteScopeSpy).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
});
