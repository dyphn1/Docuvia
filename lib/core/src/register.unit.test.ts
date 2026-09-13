import { describe, expect, it, vi } from "vitest";
import {
  DocuviaFactory,
  ErrorCodes,
  TOKENS,
} from "@workspace/contracts";
import type { IASTWorkerPool } from "./ast/ast-worker-pool.js";
import { registerCoreProviders } from "./register.js";

// TDD-SOURCE: docs/gitbook/architecture/application-lifecycle-and-state.md#1-how-it-works
// TDD-SOURCE: docs/gitbook/architecture/application-lifecycle-and-state.md#2-roles--state-management-boundaries
// TDD-SOURCE: docs/gitbook/architecture/virtual-contracts-architecture.md#8
// TDD-SOURCE: lib/contracts/src/factory/tokens.ts#TOKENS

const CORE_OWNED_TOKENS = [
  TOKENS.KnowledgeGitService,
  TOKENS.FileDiscovery,
  TOKENS.ConfigScanner,
  TOKENS.VcsScanner,
  TOKENS.AstProcessor,
  TOKENS.GraphPersister,
  TOKENS.TempFileManager,
  TOKENS.ProcessLock,
  TOKENS.QueryService,
  TOKENS.TierBCoverageHintProvider,
  TOKENS.ImpactService,
  TOKENS.ChangeDetectionService,
  TOKENS.TopologyBuilder,
  TOKENS.SnapshotRenderer,
  TOKENS.HydrationService,
  TOKENS.SemanticDiffAnalyzer,
  TOKENS.EdgeResolutionProviders,
] as const;

const fakePool = (): IASTWorkerPool =>
  ({
    initialize: vi.fn(async () => undefined),
    parse: vi.fn(),
    terminate: vi.fn(async () => undefined),
    serializeBatch: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  }) as IASTWorkerPool;

describe("Phase 8 core registration / lifetime wiring", () => {
  it("registers every core-owned token into an isolated composition factory", () => {
    const factory = new DocuviaFactory();

    registerCoreProviders(factory);

    for (const token of CORE_OWNED_TOKENS) {
      expect(factory.has(token), token.description).toBe(true);
    }
  });

  it("does not claim provider tokens owned by other implementation libraries", () => {
    const factory = new DocuviaFactory();

    registerCoreProviders(factory);

    expect(factory.has(TOKENS.GitProvider)).toBe(false);
    expect(factory.has(TOKENS.GraphStoreOpener)).toBe(false);
    expect(factory.has(TOKENS.RemoteSyncClient)).toBe(false);
    expect(factory.has(TOKENS.LlmClient)).toBe(false);
  });

  it("keeps ordinary services transient across repeated identical resolves", () => {
    const factory = new DocuviaFactory();
    registerCoreProviders(factory);

    const first = factory.resolve(TOKENS.QueryService);
    const second = factory.resolve(TOKENS.QueryService);

    expect(first).not.toBe(second);
    expect(typeof first.query).toBe("function");
    expect(typeof second.query).toBe("function");
  });

  it("defers AST worker-pool construction until first resolve and shares one pool across transient processors", () => {
    const factory = new DocuviaFactory();
    const pool = fakePool();
    const createAstWorkerPool = vi.fn(() => pool);

    registerCoreProviders(factory, { createAstWorkerPool });
    expect(createAstWorkerPool).not.toHaveBeenCalled();

    const first = factory.resolve(TOKENS.AstProcessor);
    const second = factory.resolve(TOKENS.AstProcessor);

    expect(first).not.toBe(second);
    expect(createAstWorkerPool).toHaveBeenCalledTimes(1);
  });

  it("exposes the complete Tier-B provider registry in stable order across repeated resolves", () => {
    const factory = new DocuviaFactory();
    registerCoreProviders(factory);

    const first = Object.keys(factory.resolve(TOKENS.EdgeResolutionProviders));
    const second = Object.keys(factory.resolve(TOKENS.EdgeResolutionProviders));

    expect(first).toEqual([
      "typescript",
      "python",
      "go",
      "rust",
      "cpp",
      "java",
      "csharp",
      "php",
      "ruby",
    ]);
    expect(second).toEqual(first);
  });

  it("fails closed when registration is attempted against a locked factory", () => {
    const factory = new DocuviaFactory();
    factory.lock();

    expect(() => registerCoreProviders(factory)).toThrowError(
      expect.objectContaining({ code: ErrorCodes.FACTORY_LOCKED }),
    );
  });

  it("propagates a lazy AST pool construction failure and retries cleanly on the next resolve", () => {
    const factory = new DocuviaFactory();
    const pool = fakePool();
    const constructionError = new Error("worker pool construction failed");
    const createAstWorkerPool = vi
      .fn<[], IASTWorkerPool>()
      .mockImplementationOnce(() => {
        throw constructionError;
      })
      .mockReturnValue(pool);
    registerCoreProviders(factory, { createAstWorkerPool });

    expect(() => factory.resolve(TOKENS.AstProcessor)).toThrow(
      constructionError,
    );
    expect(() => factory.resolve(TOKENS.AstProcessor)).not.toThrow();
    expect(createAstWorkerPool).toHaveBeenCalledTimes(2);
  });
});
