import { describe, it, expect, vi } from "vitest";
import type { CallResolutionStats, IGraphStore } from "@workspace/contracts";
import { GitConstants } from "@workspace/contracts";
import {
  mergeDeltaCallResolution,
  readCallResolution,
  stampFullCallResolution,
} from "./call-resolution-stats.js";

const STATS_A: CallResolutionStats = {
  total: 3,
  resolved: 1,
  selfDiscarded: 1,
  unresolved: 1,
};
const STATS_B: CallResolutionStats = {
  total: 2,
  resolved: 2,
  selfDiscarded: 0,
  unresolved: 0,
};

function makeStore(initial?: Record<string, CallResolutionStats>): {
  store: IGraphStore;
  meta: Map<string, string>;
} {
  const meta = new Map<string, string>();
  if (initial) {
    meta.set(
      GitConstants.META_KEY_CALL_RESOLUTION_STATS,
      JSON.stringify({ byFile: initial }),
    );
  }
  return {
    store: {
      meta: {
        get: (key: string) => meta.get(key),
        set: (key: string, value: string) => void meta.set(key, value),
      },
    } as unknown as IGraphStore,
    meta,
  };
}

describe("call-resolution-stats stamping", () => {
  it("stampFullCallResolution replaces the whole map (full ingestion/init semantics)", () => {
    const { store, meta } = makeStore({ "old.ts": STATS_A });
    stampFullCallResolution(store, { "new.ts": STATS_B });
    expect(readCallResolution(store)).toEqual({ "new.ts": STATS_B });
    expect(meta.has(GitConstants.META_KEY_CALL_RESOLUTION_STATS)).toBe(true);
  });

  it("stampFullCallResolution is a no-op on an empty fresh map (never wipes data with nothing)", () => {
    const { store, meta } = makeStore({ "old.ts": STATS_A });
    stampFullCallResolution(store, {});
    expect(
      JSON.parse(meta.get(GitConstants.META_KEY_CALL_RESOLUTION_STATS)!),
    ).toEqual({
      byFile: { "old.ts": STATS_A },
    });
    expect(readCallResolution(store)).toEqual({ "old.ts": STATS_A });
  });

  it("mergeDeltaCallResolution upserts reparsed files and drops deleted files' entries", () => {
    const { store } = makeStore({
      "kept.ts": STATS_A,
      "deleted.ts": STATS_B,
    });
    mergeDeltaCallResolution(store, { "kept.ts": STATS_B }, ["deleted.ts"]);
    expect(readCallResolution(store)).toEqual({ "kept.ts": STATS_B });
  });

  it("readCallResolution tolerates a corrupt stored value", () => {
    const { store } = makeStore();
    store.meta.set(GitConstants.META_KEY_CALL_RESOLUTION_STATS, "{not-json");
    expect(readCallResolution(store)).toEqual({});
  });
});
