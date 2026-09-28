import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  docuviaFactory,
  GitConstants,
  TOKENS,
  resetFactoryForTests,
  type IGraphStore,
} from "@workspace/contracts";
import {
  GraphFreshnessStates,
  resolveGraphFreshness,
} from "./resolve-graph-freshness.js";

// TDD-SOURCE: issue #508 Phase 3 staleness and graph state-transition robustness (D8)
// TDD-SOURCE: issue #193 graph freshness visibility

const GRAPH_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);

function storeWith(lastIngested: string | undefined): IGraphStore {
  return {
    meta: {
      get: vi.fn((key: string) =>
        key === GitConstants.META_KEY_LAST_INGESTED_SOURCE_SHA
          ? lastIngested
          : undefined,
      ),
      set: vi.fn(),
    },
  } as unknown as IGraphStore;
}

function registerHead(getHeadSha: () => Promise<string | undefined>) {
  docuviaFactory.register(
    TOKENS.GitProvider,
    () => ({ getHeadSha: vi.fn(getHeadSha) }) as any,
  );
  docuviaFactory.lock();
}

describe("resolveGraphFreshness() (#193, shared with impact since #508 D8)", () => {
  beforeEach(() => resetFactoryForTests());
  afterEach(() => docuviaFactory.reset());

  it("[happy] fresh when the last-ingested sha equals HEAD, with both shas", async () => {
    registerHead(async () => GRAPH_SHA);
    expect(await resolveGraphFreshness("/ws", storeWith(GRAPH_SHA))).toEqual({
      state: GraphFreshnessStates.FRESH,
      graphSourceSha: GRAPH_SHA,
      headSha: GRAPH_SHA,
    });
  });

  it("[state-diff] stale when HEAD moved past the last-ingested sha, with both shas", async () => {
    registerHead(async () => HEAD_SHA);
    expect(await resolveGraphFreshness("/ws", storeWith(GRAPH_SHA))).toEqual({
      state: GraphFreshnessStates.STALE,
      graphSourceSha: GRAPH_SHA,
      headSha: HEAD_SHA,
    });
  });

  it("[invalid-input] an empty HEAD sha or an empty last-ingested value is unknown, never fresh or stale", async () => {
    registerHead(async () => "");
    expect(await resolveGraphFreshness("/ws", storeWith(GRAPH_SHA))).toEqual({
      state: GraphFreshnessStates.UNKNOWN,
    });
    docuviaFactory.reset();
    resetFactoryForTests();
    registerHead(async () => HEAD_SHA);
    expect(await resolveGraphFreshness("/ws", storeWith(""))).toEqual({
      state: GraphFreshnessStates.UNKNOWN,
    });
  });

  it("[error-handling] fails open to unknown without a provider, HEAD, meta, or when git throws", async () => {
    docuviaFactory.lock();
    expect(await resolveGraphFreshness("/ws", storeWith(GRAPH_SHA))).toEqual({
      state: GraphFreshnessStates.UNKNOWN,
    });
    docuviaFactory.reset();
    resetFactoryForTests();
    registerHead(async () => undefined);
    expect(
      (await resolveGraphFreshness("/ws", storeWith(GRAPH_SHA))).state,
    ).toBe(GraphFreshnessStates.UNKNOWN);
    expect(
      (await resolveGraphFreshness("/ws", storeWith(undefined))).state,
    ).toBe(GraphFreshnessStates.UNKNOWN);
    docuviaFactory.reset();
    resetFactoryForTests();
    registerHead(async () => {
      throw new Error("git exploded");
    });
    expect(
      (await resolveGraphFreshness("/ws", storeWith(GRAPH_SHA))).state,
    ).toBe(GraphFreshnessStates.UNKNOWN);
  });
});
