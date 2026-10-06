import { createHash } from "node:crypto";
import {
  CALL_SITE_VERIFICATION_POLICY_VERSION,
  type CallSiteResolutionRecord,
} from "@workspace/contracts";
import {
  isRuleSignatureCertified,
  type CallResolutionCertificationDecision,
} from "./call-resolution-certification.js";

export const CALL_RESOLUTION_TIER_B_CANARY_POLICY_VERSION =
  CALL_SITE_VERIFICATION_POLICY_VERSION;
export const DEFAULT_CALL_RESOLUTION_TIER_B_CANARY_RATE = 0.1;

export interface CallResolutionTierBCanaryPolicy {
  /** A loader-validated, externally pinned one-shot artifact. Raw signature sets are not trusted. */
  readonly certification?: CallResolutionCertificationDecision;
  /** Local quarantine overrides certification until that signature is recertified. */
  readonly quarantinedRuleSignatures?: ReadonlySet<string>;
  /** Fraction sampled per rule signature. Defaults to the plan's provisional 10%. */
  readonly canaryRate?: number;
}

export function resolveCanaryRate(
  policy?: CallResolutionTierBCanaryPolicy,
): number {
  const sampleRate =
    policy?.canaryRate ?? DEFAULT_CALL_RESOLUTION_TIER_B_CANARY_RATE;
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1)
    throw new RangeError("call-resolution canary rate must be in [0, 1].");
  return sampleRate;
}

/** Stable, stratified sample for one proven call site, keyed only by the portable identity and
 *  rule signature under the versioned SHA-256 policy. */
export function isCallResolutionTierBCanary(
  callSiteKey: string,
  ruleSignature: string,
  sampleRate: number,
): boolean {
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1)
    throw new RangeError("call-resolution canary rate must be in [0, 1].");
  if (sampleRate === 0) return false;
  if (sampleRate === 1) return true;

  const hashInput = JSON.stringify([
    CALL_RESOLUTION_TIER_B_CANARY_POLICY_VERSION,
    callSiteKey,
    ruleSignature,
  ]);
  const bucket = createHash("sha256")
    .update(hashInput, "utf8")
    .digest()
    .readUInt32BE(0);
  return bucket / 0x1_0000_0000 < sampleRate;
}

/** Only a hash-bound, current proven result under an explicitly certified signature may stay on
 *  its rule. Every other class, missing certification or local quarantine remains on Tier B. */
export function isCertifiedProvenCallSite(
  resolution: CallSiteResolutionRecord,
  sourceContentHash: string,
  policy: CallResolutionTierBCanaryPolicy | undefined,
): boolean {
  if (!policy) return false;
  if (!hasProvenTarget(resolution)) return false;
  if (!hasCurrentVerification(resolution)) return false;
  if (!hasCurrentPortableIdentity(resolution)) return false;
  if (resolution.sourceContentHash !== sourceContentHash) return false;
  if (!isRuleSignatureCertified(policy.certification, resolution.ruleSignature))
    return false;
  return !policy.quarantinedRuleSignatures?.has(resolution.ruleSignature);
}

export function isCertifiedNonCanaryCallSite(
  resolution: CallSiteResolutionRecord,
  sourceContentHash: string,
  policy: CallResolutionTierBCanaryPolicy | undefined,
): boolean {
  if (!isCertifiedProvenCallSite(resolution, sourceContentHash, policy))
    return false;

  return !isCallResolutionTierBCanary(
    resolution.callSiteKey,
    resolution.ruleSignature,
    resolveCanaryRate(policy),
  );
}

function hasProvenTarget(resolution: CallSiteResolutionRecord): boolean {
  return (
    resolution.resolutionClass === "proven" &&
    resolution.selectedTargetNodeKey !== null
  );
}

function hasCurrentVerification(resolution: CallSiteResolutionRecord): boolean {
  return (
    !resolution.isStale && resolution.verificationStatus !== "contradicted"
  );
}

function hasCurrentPortableIdentity(
  resolution: CallSiteResolutionRecord,
): boolean {
  return Boolean(resolution.callSiteKey && resolution.ruleSignature);
}
