import { describe, expect, it } from "vitest";
import {
  CALLS_PROJECTION_CALLER_POLICY_ENV,
  CallsProjectionCallerPolicies,
  DEFAULT_CALLS_PROJECTION_CALLER_POLICY,
  resolveActiveCallsProjectionCallerPolicy,
} from "./calls-projection-policy.js";
import { ErrorCodes } from "../errors/error-codes.js";

describe("resolveActiveCallsProjectionCallerPolicy", () => {
  it("[regression][default-policy] defaults to exact-enclosing-v2 after full-callee parity", () => {
    expect(DEFAULT_CALLS_PROJECTION_CALLER_POLICY).toBe(
      CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2,
    );
  });

  it("[happy] returns the default when the switch is unset or blank", () => {
    expect(resolveActiveCallsProjectionCallerPolicy({})).toBe(
      DEFAULT_CALLS_PROJECTION_CALLER_POLICY,
    );
    expect(
      resolveActiveCallsProjectionCallerPolicy({
        [CALLS_PROJECTION_CALLER_POLICY_ENV]: "  ",
      }),
    ).toBe(DEFAULT_CALLS_PROJECTION_CALLER_POLICY);
  });

  it("[happy] returns a configured known policy", () => {
    expect(
      resolveActiveCallsProjectionCallerPolicy({
        [CALLS_PROJECTION_CALLER_POLICY_ENV]: " exact-enclosing-v2 ",
      }),
    ).toBe(CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2);
  });

  it("[invalid-input] [error-handling] rejects an unknown policy instead of silently using the default", () => {
    expect(() =>
      resolveActiveCallsProjectionCallerPolicy({
        [CALLS_PROJECTION_CALLER_POLICY_ENV]: "exact-enclosing-v9",
      }),
    ).toThrow(
      expect.objectContaining({ code: ErrorCodes.INVALID_INPUT }) as Error,
    );
  });
});
