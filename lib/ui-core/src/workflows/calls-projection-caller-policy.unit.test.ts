import { describe, expect, it, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import { CALLS_PROJECTION_CALLER_POLICY_META_KEY_PREFIX } from "@workspace/contracts";
import { stampFullCallsProjectionCallerPolicy } from "./calls-projection-caller-policy.js";

describe("stampFullCallsProjectionCallerPolicy", () => {
  it("records the selected policy independently from source-index completeness", () => {
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

  it("uses the ScopeResolver compatibility policy when explicitly selected", () => {
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
});
