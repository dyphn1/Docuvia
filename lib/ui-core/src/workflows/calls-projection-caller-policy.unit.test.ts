import { describe, expect, it, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import {
  CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX,
  DEFAULT_CALLS_PROJECTION_CALLER_POLICY,
  ErrorCodes,
} from "@workspace/contracts";
import { stampFullCallsProjectionCallerPolicy } from "./calls-projection-caller-policy.js";

describe("stampFullCallsProjectionCallerPolicy", () => {
  it("[happy] records the selected policy independently from source-index completeness", () => {
    const set = vi.fn();
    const meta = { set } as unknown as IGraphStore["meta"];

    stampFullCallsProjectionCallerPolicy(meta, 7, {
      DOCUVIA_CALLS_CALLER_POLICY: "exact-enclosing-v2",
    });

    expect(set).toHaveBeenCalledWith(
      `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}7`,
      "exact-enclosing-v2",
    );
  });

  it("[state-diff] uses the ScopeResolver compatibility policy when explicitly selected", () => {
    const set = vi.fn();
    const meta = { set } as unknown as IGraphStore["meta"];

    stampFullCallsProjectionCallerPolicy(meta, 3, {
      DOCUVIA_CALLS_CALLER_POLICY: "scope-resolver-v1",
    });

    expect(set).toHaveBeenCalledWith(
      `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}3`,
      "scope-resolver-v1",
    );
  });

  it("[state-diff] stamps the default policy when no policy is configured", () => {
    const set = vi.fn();
    const meta = { set } as unknown as IGraphStore["meta"];

    stampFullCallsProjectionCallerPolicy(meta, 5, {});

    expect(set).toHaveBeenCalledWith(
      `${CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX}5`,
      DEFAULT_CALLS_PROJECTION_CALLER_POLICY,
    );
  });

  it("[invalid-input] [error-handling] rejects an unknown policy without stamping the graph", () => {
    const set = vi.fn();
    const meta = { set } as unknown as IGraphStore["meta"];

    expect(() =>
      stampFullCallsProjectionCallerPolicy(meta, 9, {
        DOCUVIA_CALLS_CALLER_POLICY: "exact-enclosing-v9",
      }),
    ).toThrow(
      expect.objectContaining({ code: ErrorCodes.INVALID_INPUT }) as Error,
    );
    expect(set).not.toHaveBeenCalled();
  });
});
