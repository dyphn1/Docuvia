import { describe, it, expect, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import { GitConstants } from "@workspace/core";
import { isTierBCommitCapExceeded } from "./tier-b-commit-cap.js";

function makeStore(changedBytes: string | undefined): IGraphStore {
  return {
    meta: {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === GitConstants.META_KEY_TIER_B_CHANGED_BYTES) {
          return changedBytes;
        }
        return undefined;
      }),
      set: vi.fn(),
    },
  } as unknown as IGraphStore;
}

describe("isTierBCommitCapExceeded() (§8f D5, redefined by §9m item 1)", () => {
  it("is false when tierBChangedBytes is absent -- pre-metric-change workspace", () => {
    const store = makeStore(undefined);
    expect(isTierBCommitCapExceeded(store, 1000)).toBe(false);
  });

  it("is false when the accumulated bytes are below the cap", () => {
    const store = makeStore("999");
    expect(isTierBCommitCapExceeded(store, 1000)).toBe(false);
  });

  it("is true when the accumulated bytes exactly equal the cap", () => {
    const store = makeStore("1000");
    expect(isTierBCommitCapExceeded(store, 1000)).toBe(true);
  });

  it("is true when the accumulated bytes exceed the cap", () => {
    const store = makeStore("5000");
    expect(isTierBCommitCapExceeded(store, 1000)).toBe(true);
  });

  it("uses GitConstants.DEFAULT_TIER_B_COMMIT_CAP_BYTES when no cap is given", () => {
    const under = makeStore(
      String(GitConstants.DEFAULT_TIER_B_COMMIT_CAP_BYTES - 1),
    );
    expect(isTierBCommitCapExceeded(under)).toBe(false);

    const atCap = makeStore(
      String(GitConstants.DEFAULT_TIER_B_COMMIT_CAP_BYTES),
    );
    expect(isTierBCommitCapExceeded(atCap)).toBe(true);
  });
});
