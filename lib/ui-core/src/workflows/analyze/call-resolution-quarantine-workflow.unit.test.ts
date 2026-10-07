import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALL_RESOLUTION_RULE_CONFIGURATION_SHA256,
  createMockLogger,
  docuviaFactory,
  DocuviaError,
  ErrorCodes,
  resetFactoryForTests,
  TOKENS,
  type GraphStoreOpenOptions,
  type IGraphStore,
} from "@workspace/contracts";
import { createHash } from "node:crypto";
import { CallResolutionQuarantineWorkflow } from "./call-resolution-quarantine-workflow.js";

describe("CallResolutionQuarantineWorkflow", () => {
  beforeEach(() => resetFactoryForTests());

  afterEach(() => docuviaFactory.reset());

  it("[happy][state-diff] lists active quarantine and clear audit rows through the graph store", async () => {
    const quarantine = {
      ruleSignature: "rule-v1",
      policyVersion: "policy-v2",
      reason: "tier-b-target-mismatch" as const,
      callSiteKey: `call-site:v1:${"a".repeat(64)}`,
      sourceContentHash: "b".repeat(64),
      expectedTargetNodeKey: "src/old.ts#target",
      observedTargetNodeKey: "src/new.ts#target",
      ruleConfigurationSha256: "c".repeat(64),
      createdAt: "2026-01-01 00:00:00",
    };
    const clearAudit = {
      id: 1,
      ruleSignature: "older-rule-v1",
      quarantinePolicyVersion: "policy-v2",
      quarantineReason: "tier-b-target-mismatch" as const,
      quarantineCallSiteKey: quarantine.callSiteKey,
      quarantineSourceContentHash: quarantine.sourceContentHash,
      expectedTargetNodeKey: quarantine.expectedTargetNodeKey,
      observedTargetNodeKey: quarantine.observedTargetNodeKey,
      quarantineCreatedAt: quarantine.createdAt,
      clearedAt: "2026-01-02T00:00:00.000Z",
      method: "operator" as const,
      evidenceSha256: null,
      operator: "maintainer",
      reason: "fixed rule",
      previousRuleConfigurationSha256: "c".repeat(64),
      newRuleConfigurationSha256: "d".repeat(64),
    };
    const getRuleQuarantines = vi.fn().mockReturnValue([quarantine]);
    const getRuleQuarantineClearAudits = vi.fn().mockReturnValue([clearAudit]);
    const store = makeStore({
      getRuleQuarantines,
      getRuleQuarantineClearAudits,
    });
    const openStore = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);
    docuviaFactory.lock();

    const result = await new CallResolutionQuarantineWorkflow().list(
      "/workspace",
      createMockLogger(),
    );

    expect(result).toEqual({
      currentRuleConfigurationSha256: CALL_RESOLUTION_RULE_CONFIGURATION_SHA256,
      active: [quarantine],
      clearAudits: [clearAudit],
    });
    expect(openStore).toHaveBeenCalledWith({
      dbPath: expect.stringContaining(".docuvia"),
    });
    expect(store.close).toHaveBeenCalledOnce();
  });

  it("[happy] clears only through an explicit operator and forwards the current config hash", async () => {
    const clearRuleQuarantine = vi.fn().mockReturnValue({
      status: "cleared",
      audit: { ruleSignature: "rule-v1" },
    });
    const store = makeStore({ clearRuleQuarantine });
    const openStore = vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store);
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);
    docuviaFactory.lock();

    const result = await new CallResolutionQuarantineWorkflow().clear(
      "/workspace",
      createMockLogger(),
      "rule-v1",
      {
        kind: "operator",
        operator: "maintainer@example.test",
        reason: "fixed and reviewed",
      },
    );

    expect(result.status).toBe("cleared");
    expect(clearRuleQuarantine).toHaveBeenCalledWith(12, "rule-v1", {
      newRuleConfigurationSha256: CALL_RESOLUTION_RULE_CONFIGURATION_SHA256,
      evidence: {
        kind: "operator",
        operator: "maintainer@example.test",
        reason: "fixed and reviewed",
      },
    });
    expect(store.close).toHaveBeenCalledOnce();
  });

  it("[invalid-input][error-handling] rejects an untrusted artifact before opening the database", async () => {
    const rawArtifact = "{}";
    const trustedInputsJson = JSON.stringify({
      artifactSha256: createHash("sha256").update(rawArtifact).digest("hex"),
      implementationCommitSha: "a".repeat(40),
      ruleConfigurationSha256: CALL_RESOLUTION_RULE_CONFIGURATION_SHA256,
      oracleIdentity: "typescript-language-server",
      oracleVersion: "5.9.2",
      oracleConfigurationSha256: "b".repeat(64),
      corpusManifestSha256: "c".repeat(64),
      newFamily: {
        familyId: "family-a",
        revision: "revision-a",
        splitSha256: "d".repeat(64),
      },
      temporal: {
        familyId: "family-b",
        revision: "revision-b",
        baseRevision: "revision-base",
        splitSha256: "e".repeat(64),
      },
    });
    const openStore = vi.fn();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);
    docuviaFactory.lock();

    await expect(
      new CallResolutionQuarantineWorkflow().clear(
        "/workspace",
        createMockLogger(),
        "rule-v1",
        {
          kind: "certification",
          artifact: rawArtifact,
          trustedInputsJson,
        },
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_INPUT });
    expect(openStore).not.toHaveBeenCalled();
  });

  it("[invalid-input] rejects an operator clear without both identity and reason", async () => {
    const openStore = vi.fn();
    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);
    docuviaFactory.lock();

    await expect(
      new CallResolutionQuarantineWorkflow().clear(
        "/workspace",
        createMockLogger(),
        "rule-v1",
        { kind: "operator", operator: "", reason: "" },
      ),
    ).rejects.toBeInstanceOf(DocuviaError);
    expect(openStore).not.toHaveBeenCalled();
  });
});

function makeStore(
  repoOverrides: Record<string, unknown> = {},
): IGraphStore & { close: ReturnType<typeof vi.fn> } {
  return {
    projects: {
      getFirst: vi
        .fn()
        .mockReturnValue({ id: 12, name: "project", repoUrl: "/workspace" }),
      insert: vi.fn(),
      getOrInsert: vi.fn(),
      count: vi.fn(),
    },
    callSiteResolutions: {
      getRuleQuarantines: vi.fn().mockReturnValue([]),
      getRuleQuarantineClearAudits: vi.fn().mockReturnValue([]),
      clearRuleQuarantine: vi.fn(),
      ...repoOverrides,
    } as unknown as IGraphStore["callSiteResolutions"],
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGraphStore & { close: ReturnType<typeof vi.fn> };
}
