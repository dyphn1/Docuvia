import { DocuviaError } from "../errors/docuvia-error.js";
import { ErrorCodes } from "../errors/error-codes.js";

/** Persisted identifier for the caller-attribution rule used by `node_links(calls)`. */
export const CallsProjectionCallerPolicies = {
  SCOPE_RESOLVER_V1: "scope-resolver-v1",
  EXACT_ENCLOSING_V1: "exact-enclosing-v1",
  EXACT_ENCLOSING_V2: "exact-enclosing-v2",
} as const;

export type CallsProjectionCallerPolicy =
  (typeof CallsProjectionCallerPolicies)[keyof typeof CallsProjectionCallerPolicies];

export function isCallsProjectionCallerPolicy(
  value: unknown,
): value is CallsProjectionCallerPolicy {
  return (
    typeof value === "string" &&
    Object.values(CallsProjectionCallerPolicies).some(
      (policy) => policy === value,
    )
  );
}

/** Exact v2 is the default after the full-callee parity audit found no named-function omissions. */
export const DEFAULT_CALLS_PROJECTION_CALLER_POLICY: CallsProjectionCallerPolicy =
  CallsProjectionCallerPolicies.EXACT_ENCLOSING_V2;

/**
 * Opt-in evaluation switch for the active caller policy. Unset or empty means the default.
 * Init/analyze persist under this policy, and analyze rebuilds a graph whose stored policy
 * differs from it, so an exact-policy graph is not silently rebuilt back to the default.
 */
export const CALLS_PROJECTION_CALLER_POLICY_ENV = "DOCUVIA_CALLS_CALLER_POLICY";

/** Resolves the configured active policy; an unknown value is a configuration error. */
export function resolveActiveCallsProjectionCallerPolicy(
  env: Readonly<Record<string, string | undefined>>,
): CallsProjectionCallerPolicy {
  const configured = env[CALLS_PROJECTION_CALLER_POLICY_ENV]?.trim();
  if (!configured) return DEFAULT_CALLS_PROJECTION_CALLER_POLICY;
  if (isCallsProjectionCallerPolicy(configured)) return configured;
  throw new DocuviaError(
    ErrorCodes.INVALID_INPUT,
    `${CALLS_PROJECTION_CALLER_POLICY_ENV}=${configured} is not one of: ${Object.values(
      CallsProjectionCallerPolicies,
    ).join(", ")}`,
  );
}

/** Project-scoped marker for the caller policy used by the stored calls projection. */
export const CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX =
  "graph.calls-projection.caller-policy.v1:";

/** Snapshot metadata capability version, independent of the outer snapshot format. */
export const SNAPSHOT_CALLS_PROJECTION_CALLER_POLICY_VERSION = 1;
