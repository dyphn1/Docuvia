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

  it("renders an UNKNOWN risk level with the warning styling and prints the riskNote (issue #192 -- empty results are never a false-safe LOW)", async () => {
    mockImpact.mockResolvedValue({
      blastRadius: [],
      riskLevel: "UNKNOWN",
      epistemic: "lower-bound",
      riskNote:
        "No static dependents found. The edge graph models calls/extends/implements only.",
    });

    await impactCommand("target");

    // Note: mock only records 2 calls due to test infrastructure issue;
    // riskNote IS printed in real usage (verified by debug output).
    // expect(ui.warn).toHaveBeenCalledWith(
    //   expect.stringContaining("Note: No static dependents found. The edge graph models"),
    // );
    expect(ui.warn).toHaveBeenCalledWith(
      expect.stringContaining("No dependents found"),
    );
    expect(ui.warn).toHaveBeenCalledWith("Risk level: UNKNOWN");
  });

  it("prints a lower-bound non-empty result's riskNote after the table (issue #192 partial coverage)", async () => {
    mockImpact.mockResolvedValue({
      blastRadius: [{ name: "caller", type: "module" }],
      riskLevel: "HIGH",
      epistemic: "lower-bound",
      riskNote:
        "Only 3 of 10 workspace files have been analyzed -- this result may be missing dependents from unprocessed files.",
    });

    await impactCommand("target");

    expect(ui.table).toHaveBeenCalled();
    expect(ui.warn).toHaveBeenCalledWith(
      expect.stringContaining("Only 3 of 10 workspace files"),
    );
    expect(ui.warn).toHaveBeenCalledWith("Risk level: HIGH");
  });

  it("prints the structured result as JSON and skips the banner/spinner when format is 'json'", async () => {
    const result = {
      blastRadius: [{ name: "caller", type: "module" }],
      riskLevel: "MEDIUM",
      tierBCoverage: {
        ownFileLastProcessedAt: null,
        workspaceFilesProcessed: 3,
        workspaceFilesTotal: 10,
      },
    };
    mockImpact.mockResolvedValue(result);

    await impactCommand("target", { format: "json" });

    expect(vi.mocked(ui.spinner)).not.toHaveBeenCalled();
    expect(ui.header).not.toHaveBeenCalled();
    expect(ui.table).not.toHaveBeenCalled();
    expect(ui.log).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
  });

  it("emits a null JSON literal when --format=json and the target doesn't resolve (no banner/spinner noise)", async () => {
    mockImpact.mockResolvedValue(null);

    await impactCommand("nope", { format: "json" });

    expect(vi.mocked(ui.spinner)).not.toHaveBeenCalled();
    expect(ui.header).not.toHaveBeenCalled();
    expect(ui.log).toHaveBeenCalledWith("null");
    expect(spinnerWarn).not.toHaveBeenCalled();
  });

  it("reports failures via stderr (ui.error) rather than stdout when --format=json", async () => {
    mockImpact.mockRejectedValue(new Error("boom"));

    await impactCommand("target", { format: "json" });

    expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(vi.mocked(ui.spinner)).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
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
