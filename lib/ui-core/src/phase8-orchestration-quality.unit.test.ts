import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./utils/command-log-writer.js", () => ({
  appendCommandLogLine: vi.fn(async () => undefined),
}));

import {
  createMockLogger,
  docuviaFactory,
  resetFactoryForTests,
  TOKENS,
  type IGraphStore,
  type IHydrationService,
  type IQueryService,
} from "@workspace/contracts";
import { QueryWorkflow } from "./workflows/query/query-workflow.js";
import { HydrateWorkflow } from "./workflows/hydrate/hydrate-workflow.js";

// TDD-SOURCE: docs/gitbook/architecture/application-lifecycle-and-state.md#1-how-it-works
// TDD-SOURCE: docs/gitbook/architecture/application-lifecycle-and-state.md#2-roles--state-management-boundaries
// TDD-SOURCE: lib/ui-core/src/workflows/query/query-workflow.ts#QueryWorkflow.execute
// TDD-SOURCE: lib/ui-core/src/workflows/hydrate/hydrate-workflow.ts#HydrateWorkflow.execute

function makeClosableStore(): IGraphStore {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGraphStore;
}

function makeHydrationService(
  overrides: Partial<IHydrationService> = {},
): IHydrationService {
  return {
    isStale: vi.fn().mockResolvedValue(false),
    hydrate: vi.fn(),
    ...overrides,
  } as unknown as IHydrationService;
}

function makeQueryService(query: IQueryService["query"]): IQueryService {
  return { query } as unknown as IQueryService;
}

describe("Phase 8 UI-core orchestration quality", () => {
  beforeEach(() => {
    resetFactoryForTests();
  });

  afterEach(() => {
    docuviaFactory.reset();
  });

  it("returns identical query output across repeated identical orchestration and closes every acquired store", async () => {
    const stores: IGraphStore[] = [];
    const openStore = vi.fn(async () => {
      const store = makeClosableStore();
      stores.push(store);
      return store;
    });
    const expected = {
      l2: { name: "authService", matchType: "exact" as const },
      l3: [],
      context: null,
    };
    const query = vi.fn().mockReturnValue(expected);

    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeHydrationService(),
    );
    docuviaFactory.register(TOKENS.QueryService, () => makeQueryService(query));
    docuviaFactory.lock();

    const first = await new QueryWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute("authService", 5);
    const second = await new QueryWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute("authService", 5);

    expect(second).toEqual(first);
    expect(second).toEqual(expected);
    expect(openStore).toHaveBeenCalledTimes(4);
    expect(stores).toHaveLength(4);
    for (const store of stores) {
      expect(store.close).toHaveBeenCalledTimes(1);
    }
  });

  it("closes query resources when a resolved domain service throws without rewriting the failure", async () => {
    const stores: IGraphStore[] = [];
    const openStore = vi.fn(async () => {
      const store = makeClosableStore();
      stores.push(store);
      return store;
    });
    const queryError = new Error("query service failed");

    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeHydrationService(),
    );
    docuviaFactory.register(TOKENS.QueryService, () =>
      makeQueryService(
        vi.fn(() => {
          throw queryError;
        }),
      ),
    );
    docuviaFactory.lock();

    await expect(
      new QueryWorkflow("/workspace/demo", createMockLogger()).execute(
        "authService",
        5,
      ),
    ).rejects.toThrow(queryError);

    expect(stores).toHaveLength(2);
    for (const store of stores) {
      expect(store.close).toHaveBeenCalledTimes(1);
    }
  });

  it("propagates hydrate options exactly and produces equivalent results across repeated runs", async () => {
    const stores: IGraphStore[] = [];
    const openStore = vi.fn(async () => {
      const store = makeClosableStore();
      stores.push(store);
      return store;
    });
    const hydrationResult = {
      hydrated: true,
      knowledgeSha: "abc1234",
      nodesLoaded: 2,
      edgesLoaded: 1,
      edgesDropped: 0,
    };
    const hydrate = vi.fn().mockResolvedValue(hydrationResult);
    const service = makeHydrationService({ hydrate });

    docuviaFactory.register(TOKENS.GraphStoreOpener, () => openStore);
    docuviaFactory.register(TOKENS.HydrationService, () => service);
    docuviaFactory.lock();

    const first = await new HydrateWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute({ force: true });
    const second = await new HydrateWorkflow(
      "/workspace/demo",
      createMockLogger(),
    ).execute({ force: true });

    expect(second).toEqual(first);
    expect(second).toEqual(hydrationResult);
    expect(hydrate).toHaveBeenNthCalledWith(
      1,
      "/workspace/demo",
      stores[0],
      undefined,
      { force: true },
    );
    expect(hydrate).toHaveBeenNthCalledWith(
      2,
      "/workspace/demo",
      stores[1],
      undefined,
      { force: true },
    );
    expect(stores).toHaveLength(2);
    for (const store of stores) {
      expect(store.close).toHaveBeenCalledTimes(1);
    }
  });

  it("closes hydrate resources when hydration rejects", async () => {
    const store = makeClosableStore();
    const hydrateError = new Error("hydrate failed");

    docuviaFactory.register(TOKENS.GraphStoreOpener, () =>
      vi.fn().mockResolvedValue(store),
    );
    docuviaFactory.register(TOKENS.HydrationService, () =>
      makeHydrationService({
        hydrate: vi.fn().mockRejectedValue(hydrateError),
      }),
    );
    docuviaFactory.lock();

    await expect(
      new HydrateWorkflow("/workspace/demo", createMockLogger()).execute({
        force: false,
      }),
    ).rejects.toThrow(hydrateError);
    expect(store.close).toHaveBeenCalledTimes(1);
  });
});
