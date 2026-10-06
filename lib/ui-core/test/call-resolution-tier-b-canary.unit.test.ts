import { describe, expect, it } from "vitest";
import type { CallSiteResolutionRecord } from "@workspace/contracts";
import { CALL_SITE_VERIFICATION_POLICY_VERSION } from "@workspace/contracts";
import {
  CALL_RESOLUTION_TIER_B_CANARY_POLICY_VERSION,
  isCertifiedNonCanaryCallSite,
  isCertifiedProvenCallSite,
  isCallResolutionTierBCanary,
  resolveCanaryRate,
} from "../src/workflows/analyze/call-resolution-tier-b-canary.js";
import { createTestCertificationDecision } from "./helpers/call-resolution-certification.fixture.js";

function provenResolution(ruleSignature = "rule-A"): CallSiteResolutionRecord {
  return {
    callSiteKey: `call-site:v1:${"0".repeat(64)}`,
    identityVersion: 1,
    filePath: "src/caller.ts",
    sourceContentHash: "a".repeat(64),
    startLine: 0,
    startColumn: 0,
    calleeKind: "identifier",
    calleeName: "invoke",
    callerNodeKey: "src/caller.ts#caller",
    resolutionClass: "proven",
    selectedTargetNodeKey: "src/target.ts#target",
    confidence: null,
    resolver: "strict-proof",
    ruleSignature,
    dependencyFingerprint: "b".repeat(64),
    dependencies: [],
    verificationStatus: "unverified",
    verifiedTargetNodeKey: null,
    isStale: false,
    candidates: [],
  };
}

describe("Tier B call-resolution canary selection", () => {
  it("[state-diff] versions the sampler after removing resolution class from its hash inputs", () => {
    // Phase 4 specifies call-site key + rule signature. The previous policy included
    // resolution class, which let a site move strata when its classification changed.
    expect(CALL_SITE_VERIFICATION_POLICY_VERSION).toBe(
      "sha256-callsite-rule-v2",
    );
  });

  it("[happy] uses the versioned portable-key/signature hash for a deterministic stratified subset", () => {
    const selected = (ruleSignature: string) =>
      Array.from({ length: 8 }, (_, index) => {
        const callSiteKey = `call-site:v1:${String(index).padStart(64, "0")}`;
        return isCallResolutionTierBCanary(callSiteKey, ruleSignature, 0.5)
          ? index
          : undefined;
      }).filter((index): index is number => index !== undefined);

    expect(CALL_RESOLUTION_TIER_B_CANARY_POLICY_VERSION).toBe(
      "sha256-callsite-rule-v2",
    );
    expect(selected("rule-A")).toEqual([0, 1, 2, 6]);
    expect(selected("rule-A")).toEqual(selected("rule-A"));
    expect(
      isCallResolutionTierBCanary(
        `call-site:v1:${"0".repeat(63)}1`,
        "rule-A",
        0.5,
      ),
    ).toBe(true);
    expect(
      isCallResolutionTierBCanary(
        `call-site:v1:${"0".repeat(63)}1`,
        "rule-B",
        0.5,
      ),
    ).toBe(false);
  });

  it("[happy] defines the exact zero and full sampling boundaries", () => {
    expect(
      isCallResolutionTierBCanary(
        `call-site:v1:${"0".repeat(64)}`,
        "rule-A",
        0,
      ),
    ).toBe(false);
    expect(
      isCallResolutionTierBCanary(
        `call-site:v1:${"0".repeat(64)}`,
        "rule-A",
        1,
      ),
    ).toBe(true);
    expect(resolveCanaryRate({})).toBe(0.1);
  });

  it("[invalid-input][error-handling] rejects a canary rate outside the documented range", () => {
    expect(() =>
      resolveCanaryRate({
        canaryRate: Number.NaN,
      }),
    ).toThrow(/must be in \[0, 1\]/);
    expect(() =>
      isCallResolutionTierBCanary(
        `call-site:v1:${"0".repeat(64)}`,
        "rule-A",
        1.01,
      ),
    ).toThrow(/must be in \[0, 1\]/);
  });

  it("[happy][invalid-input][state-diff] lets only a current loader-bound artifact skip non-canary proven rows", () => {
    const resolution = provenResolution();
    const certification = createTestCertificationDecision(["rule-A"]);
    expect(certification.certifiedRuleSignatures).toEqual(["rule-A"]);
    expect(
      isCertifiedProvenCallSite(resolution, resolution.sourceContentHash, {
        certification,
        canaryRate: 0,
      }),
    ).toBe(true);
    expect(
      isCertifiedNonCanaryCallSite(resolution, resolution.sourceContentHash, {
        certification,
        canaryRate: 0,
      }),
    ).toBe(true);
    expect(
      isCertifiedNonCanaryCallSite(resolution, resolution.sourceContentHash, {
        certification,
        canaryRate: 1,
      }),
    ).toBe(false);
    expect(
      isCertifiedProvenCallSite(resolution, "c".repeat(64), {
        certification,
        canaryRate: 0,
      }),
    ).toBe(false);
  });

  it("[state-diff] a locally quarantined signature loses its certified skip permission", () => {
    const resolution = provenResolution();
    const certification = createTestCertificationDecision(["rule-A"]);

    expect(
      isCertifiedNonCanaryCallSite(resolution, resolution.sourceContentHash, {
        certification,
        canaryRate: 0,
        quarantinedRuleSignatures: new Set(["rule-A"]),
      }),
    ).toBe(false);
  });

  it("[invalid-input][error-handling] fails closed for caller-built and cloned certification sets", () => {
    const resolution = provenResolution();
    const certified = createTestCertificationDecision(["rule-A"]);
    const forged = {
      artifactSha256: "c".repeat(64),
      status: "loaded",
      certifiedRuleSignatures: new Set(["rule-A"]),
      rejectionReasons: [],
    };
    const cloned = { ...certified };

    expect(
      isCertifiedProvenCallSite(resolution, resolution.sourceContentHash, {
        certification: forged as never,
      }),
    ).toBe(false);
    expect(
      isCertifiedProvenCallSite(resolution, resolution.sourceContentHash, {
        certification: cloned as never,
      }),
    ).toBe(false);
  });
});
