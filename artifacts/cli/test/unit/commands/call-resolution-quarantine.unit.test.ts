import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import process from "process";
import { docuviaApi } from "@workspace/ui-core";
import { callResolutionQuarantineCommand } from "../../../src/commands/call-resolution-quarantine.js";
import { ui } from "../../../src/ui/wizard.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: {
    listCallResolutionQuarantines: vi.fn(),
    clearCallResolutionQuarantine: vi.fn(),
  },
}));

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    table: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const mockList = vi.mocked(docuviaApi.listCallResolutionQuarantines);
const mockClear = vi.mocked(docuviaApi.clearCallResolutionQuarantine);

describe("callResolutionQuarantineCommand", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockClear.mockReset();
    vi.mocked(ui.header).mockReset();
    vi.mocked(ui.table).mockReset();
    vi.mocked(ui.success).mockReset();
    vi.mocked(ui.info).mockReset();
    vi.mocked(ui.error).mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("[happy] list prints active quarantines and audit history", async () => {
    mockList.mockResolvedValue({
      currentRuleConfigurationSha256: "a".repeat(64),
      active: [
        {
          ruleSignature: "rule-v1",
          policyVersion: "policy-v2",
          reason: "tier-b-target-mismatch",
          callSiteKey: `call-site:v1:${"b".repeat(64)}`,
          sourceContentHash: "c".repeat(64),
          expectedTargetNodeKey: "src/expected.ts#run",
          observedTargetNodeKey: "src/observed.ts#run",
          ruleConfigurationSha256: "d".repeat(64),
          createdAt: "2026-01-01 00:00:00",
        },
      ],
      clearAudits: [
        {
          id: 1,
          ruleSignature: "rule-v1",
          quarantinePolicyVersion: "policy-v2",
          quarantineReason: "tier-b-target-mismatch",
          quarantineCallSiteKey: `call-site:v1:${"b".repeat(64)}`,
          quarantineSourceContentHash: "c".repeat(64),
          expectedTargetNodeKey: "src/expected.ts#run",
          observedTargetNodeKey: "src/observed.ts#run",
          quarantineCreatedAt: "2026-01-01 00:00:00",
          clearedAt: "2026-01-02T00:00:00.000Z",
          method: "certification",
          evidenceSha256: "e".repeat(64),
          operator: null,
          reason: null,
          previousRuleConfigurationSha256: "d".repeat(64),
          newRuleConfigurationSha256: "f".repeat(64),
        },
      ],
    });

    await callResolutionQuarantineCommand(
      "quarantine",
      "list",
      undefined,
      {},
      "/workspace",
    );

    expect(ui.table).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        [
          "rule-v1",
          "2026-01-01 00:00:00",
          "tier-b-target-mismatch",
          "d".repeat(64),
        ],
      ]),
    );
    expect(ui.table).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        [
          "rule-v1",
          "2026-01-02T00:00:00.000Z",
          "certification",
          "e".repeat(64),
          "—",
          "—",
          "d".repeat(64),
          "f".repeat(64),
        ],
      ]),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("[happy][state-diff] previews the exact hash change before an operator clear", async () => {
    mockList.mockResolvedValue({
      currentRuleConfigurationSha256: "e".repeat(64),
      active: [
        {
          ruleSignature: "rule-v1",
          policyVersion: "policy-v2",
          reason: "tier-b-target-mismatch",
          callSiteKey: `call-site:v1:${"f".repeat(64)}`,
          sourceContentHash: "1".repeat(64),
          expectedTargetNodeKey: "src/expected.ts#run",
          observedTargetNodeKey: "src/observed.ts#run",
          ruleConfigurationSha256: "2".repeat(64),
          createdAt: "2026-01-01 00:00:00",
        },
      ],
      clearAudits: [],
    });
    mockClear.mockResolvedValue({
      status: "cleared",
      audit: { ruleSignature: "rule-v1" } as never,
    });

    await callResolutionQuarantineCommand(
      "quarantine",
      "clear",
      "rule-v1",
      { operator: "maintainer", reason: "rule fix reviewed" },
      "/workspace",
    );

    const previewIndex = vi
      .mocked(ui.header)
      .mock.calls.findIndex(([title]) => String(title).includes("Preview"));
    expect(previewIndex).toBeGreaterThanOrEqual(0);
    expect(
      vi.mocked(ui.header).mock.invocationCallOrder[previewIndex],
    ).toBeLessThan(mockClear.mock.invocationCallOrder[0]);
    expect(mockClear).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      "rule-v1",
      {
        kind: "operator",
        operator: "maintainer",
        reason: "rule fix reviewed",
      },
    );
    expect(ui.success).toHaveBeenCalled();
  });

  it("[invalid-input][error-handling] refuses a clear without either evidence mode", async () => {
    await callResolutionQuarantineCommand(
      "quarantine",
      "clear",
      "rule-v1",
      {},
      "/workspace",
    );

    expect(mockClear).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalledWith(
      expect.stringContaining("--artifact"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("[invalid-input] rejects a partial or mixed evidence mode", async () => {
    await callResolutionQuarantineCommand(
      "quarantine",
      "clear",
      "rule-v1",
      { operator: "maintainer", artifactPath: "cert.json" },
      "/workspace",
    );

    expect(mockClear).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
