import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  docuviaFactory,
  TOKENS,
  resetFactoryForTests,
  createMockLogger,
  type EdgeResolutionAvailability,
  type GraphStoreOpenOptions,
  type IEdgeResolutionProvider,
  type IGraphStore,
} from "@workspace/contracts";
import { checkTierBGate } from "./tier-b-gate.js";
import { appendTierBQueueEntries } from "./tier-b-queue.js";

function makeStore(meta: Record<string, string> = {}): {
  store: IGraphStore;
  metaMap: Map<string, string>;
} {
  const metaMap = new Map(Object.entries(meta));
  const store = {
    meta: {
      get: (key: string) => metaMap.get(key),
      set: (key: string, value: string) => {
        metaMap.set(key, value);
      },
    },
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGraphStore;
  return { store, metaMap };
}

function registerGraphStoreOpener(store: IGraphStore): void {
  docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
    vi
      .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
      .mockResolvedValue(store),
  );
}

function makeProvider(
  checkAvailability: () => Promise<EdgeResolutionAvailability>,
  name = "fake-provider",
): IEdgeResolutionProvider {
  return {
    name,
    configure: vi.fn(),
    checkAvailability,
    resolveEdges: vi.fn(),
  } as unknown as IEdgeResolutionProvider;
}

beforeEach(() => {
  resetFactoryForTests();
});

describe("checkTierBGate() (roadmap Item 17: scoped to tierBQueue)", () => {
  it("only checks the availability of the language(s) actually queued, ignoring an unrelated registered language", async () => {
    const { store } = makeStore();
    appendTierBQueueEntries(store, [{ file: "a.ts", commitSha: "sha1" }]);
    registerGraphStoreOpener(store);

    const tsCheck = vi.fn().mockResolvedValue({ available: true });
    const pyCheck = vi.fn().mockResolvedValue({
      available: false,
      reason: "pyright not installed",
    });
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => makeProvider(tsCheck, "typescript-language-server"),
      python: () => makeProvider(pyCheck, "pyright"),
    }));

    const result = await checkTierBGate("/workspace", createMockLogger());

    expect(result.available).toBe(true);
    expect(tsCheck).toHaveBeenCalledTimes(1);
    expect(pyCheck).not.toHaveBeenCalled();
  });

  it("returns { available: true } trivially on an empty tierBQueue, without calling any provider", async () => {
    const { store } = makeStore();
    registerGraphStoreOpener(store);

    const tsCheck = vi.fn().mockResolvedValue({ available: true });
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => makeProvider(tsCheck),
    }));

    const result = await checkTierBGate("/workspace", createMockLogger());

    expect(result).toEqual({ available: true });
    expect(tsCheck).not.toHaveBeenCalled();
  });

  it("checks every queued language when the queue spans more than one, surfacing the unavailable one's reason unchanged", async () => {
    const { store } = makeStore();
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: "sha1" },
      { file: "b.py", commitSha: "sha1" },
    ]);
    registerGraphStoreOpener(store);

    const tsCheck = vi.fn().mockResolvedValue({ available: true });
    const pyCheck = vi.fn().mockResolvedValue({
      available: false,
      reason: "pyright not installed",
    });
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => makeProvider(tsCheck, "typescript-language-server"),
      python: () => makeProvider(pyCheck, "pyright"),
    }));

    const result = await checkTierBGate("/workspace", createMockLogger());

    expect(tsCheck).toHaveBeenCalledTimes(1);
    expect(pyCheck).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      available: false,
      reason: "pyright not installed",
    });
  });

  it("skips a queued language with no registered provider, without throwing", async () => {
    const { store } = makeStore();
    appendTierBQueueEntries(store, [
      { file: "a.ts", commitSha: "sha1" },
      { file: "b.py", commitSha: "sha1" },
    ]);
    registerGraphStoreOpener(store);

    const tsCheck = vi.fn().mockResolvedValue({ available: true });
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => makeProvider(tsCheck),
    }));

    const result = await checkTierBGate("/workspace", createMockLogger());

    expect(result).toEqual({ available: true });
    expect(tsCheck).toHaveBeenCalledTimes(1);
  });

  it("falls back to checking every registered language when openStore() throws (e.g. no local db yet)", async () => {
    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi
        .fn<[GraphStoreOpenOptions], Promise<IGraphStore>>()
        .mockRejectedValue(new Error("DB_OPEN_FAILED")),
    );

    const tsCheck = vi.fn().mockResolvedValue({ available: true });
    const pyCheck = vi.fn().mockResolvedValue({ available: true });
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => makeProvider(tsCheck),
      python: () => makeProvider(pyCheck),
    }));

    const result = await checkTierBGate("/workspace", createMockLogger());

    expect(result).toEqual({ available: true });
    expect(tsCheck).toHaveBeenCalledTimes(1);
    expect(pyCheck).toHaveBeenCalledTimes(1);
  });

  it("falls back to checking every registered language when TOKENS.GraphStoreOpener is not registered at all", async () => {
    const tsCheck = vi.fn().mockResolvedValue({ available: true });
    const pyCheck = vi.fn().mockResolvedValue({ available: true });
    docuviaFactory.register(TOKENS.EdgeResolutionProviders, () => ({
      typescript: () => makeProvider(tsCheck),
      python: () => makeProvider(pyCheck),
    }));

    const result = await checkTierBGate("/workspace", createMockLogger());

    expect(result).toEqual({ available: true });
    expect(tsCheck).toHaveBeenCalledTimes(1);
    expect(pyCheck).toHaveBeenCalledTimes(1);
  });
});
