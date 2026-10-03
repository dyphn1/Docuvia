import { describe, expect, it } from "vitest";
import type { CallSiteResolutionClass } from "@workspace/contracts";
import {
  CALL_RESOLUTION_TIER_B_CANARY_POLICY_VERSION,
  isCallResolutionTierBCanary,
  resolveCanaryRate,
} from "../src/workflows/analyze/call-resolution-tier-b-canary.js";

describe("Tier B call-resolution canary selection", () => {
  it("[happy] uses the versioned portable-key/signature/class hash for a deterministic stratified subset", () => {
    const selected = (
      ruleSignature: string,
      resolutionClass: CallSiteResolutionClass = "proven",
    ) =>
      Array.from({ length: 8 }, (_, index) => {
        const callSiteKey = `call-site:v1:${String(index).padStart(64, "0")}`;
        return isCallResolutionTierBCanary(
          callSiteKey,
          ruleSignature,
          resolutionClass,
          0.5,
        )
          ? index
          : undefined;
      }).filter((index): index is number => index !== undefined);

    expect(CALL_RESOLUTION_TIER_B_CANARY_POLICY_VERSION).toBe(
      "sha256-callsite-rule-class-v1",
    );
    expect(selected("rule-A")).toEqual([0, 1, 2, 3, 4, 6]);
    expect(selected("rule-A")).toEqual(selected("rule-A"));
    expect(
      isCallResolutionTierBCanary(
        `call-site:v1:${"0".repeat(63)}1`,
        "rule-A",
        "proven",
        0.5,
      ),
    ).toBe(true);
    expect(
      isCallResolutionTierBCanary(
        `call-site:v1:${"0".repeat(63)}1`,
        "rule-B",
        "proven",
        0.5,
      ),
    ).toBe(false);
    expect(
      isCallResolutionTierBCanary(
        `call-site:v1:${"0".repeat(63)}1`,
        "rule-A",
        "likely",
        0.5,
      ),
    ).toBe(false);
  });

  it("[happy] defines the exact zero and full sampling boundaries", () => {
    expect(
      isCallResolutionTierBCanary(
        `call-site:v1:${"0".repeat(64)}`,
        "rule-A",
        "proven",
        0,
      ),
    ).toBe(false);
    expect(
      isCallResolutionTierBCanary(
        `call-site:v1:${"0".repeat(64)}`,
        "rule-A",
        "proven",
        1,
      ),
    ).toBe(true);
    expect(resolveCanaryRate({ certifiedRuleSignatures: new Set() })).toBe(0.1);
  });

  it("[invalid-input][error-handling] rejects a canary rate outside the documented range", () => {
    expect(() =>
      resolveCanaryRate({
        certifiedRuleSignatures: new Set(),
        canaryRate: Number.NaN,
      }),
    ).toThrow(/must be in \[0, 1\]/);
    expect(() =>
      isCallResolutionTierBCanary(
        `call-site:v1:${"0".repeat(64)}`,
        "rule-A",
        "proven",
        1.01,
      ),
    ).toThrow(/must be in \[0, 1\]/);
  });
});
