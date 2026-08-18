import { describe, it, expect, vi } from "vitest";
import type { IGraphStore } from "@workspace/contracts";
import { CURRENT_NODE_KEY_FORMAT_VERSION } from "@workspace/core";
import { GitConstants } from "@workspace/contracts";
import { isNodeKeyFormatStale } from "./node-key-format-guard.js";

function makeStore(stamped: string | undefined): IGraphStore {
  return {
    meta: {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === GitConstants.META_KEY_NODE_KEY_FORMAT_VERSION) {
          return stamped;
        }
        return undefined;
      }),
      set: vi.fn(),
    },
  } as unknown as IGraphStore;
}

describe("isNodeKeyFormatStale() (GRPH-006)", () => {
  it("is true when no stamp exists at all (pre-Slice graph)", () => {
    const store = makeStore(undefined);
    expect(isNodeKeyFormatStale(store)).toBe(true);
  });

  it("is true when the stamp is an old literal version", () => {
    const store = makeStore("1");
    expect(isNodeKeyFormatStale(store)).toBe(true);
  });

  it("is false when the stamp equals CURRENT_NODE_KEY_FORMAT_VERSION", () => {
    const store = makeStore(CURRENT_NODE_KEY_FORMAT_VERSION);
    expect(isNodeKeyFormatStale(store)).toBe(false);
  });
});
