import {
  docuviaFactory,
  TOKENS,
  type DocuviaFactory,
} from "@workspace/contracts";
import { KnowledgeGitService } from "./git/knowledge-git.service.js";
import { SnapshotRendererService } from "./git/snapshot-renderer.service.js";
import { ChangeDetectionService } from "./git/change-detection.service.js";
import { HydrationService } from "./git/hydration.service.js";
import { FileDiscoveryService } from "./discovery/file-discovery.service.js";
import { ConfigScannerService } from "./discovery/config-scanner.service.js";
import { VcsScannerService } from "./discovery/vcs-scanner.service.js";
import { AstProcessingService } from "./ast/ast-processing.service.js";
import { AstWorkerPool, type IASTWorkerPool } from "./ast/ast-worker-pool.js";
import { GraphPersisterService } from "./graph/phase393-graph-persister.js";
import { TempFileManager } from "./temp-files/temp-file-manager.js";
import { QueryService } from "./query/query.service.js";
import { resolveTierBCoverageHint } from "./graph/tier-b-coverage.js";
import { ImpactService } from "./impact/phase393-impact.service.js";
import { TopologyBuilderService } from "./topology/topology-builder.service.js";
import { SemanticDiffAnalyzerService } from "./detector/semantic-diff-analyzer.service.js";
import { TypescriptLspEdgeProvider } from "./lsp/typescript-lsp-edge-provider.js";
import { PythonLspEdgeProvider } from "./lsp/python-lsp-edge-provider.js";
import { GoLspEdgeProvider } from "./lsp/go-lsp-edge-provider.js";
import { RustLspEdgeProvider } from "./lsp/rust-lsp-edge-provider.js";
import { CppLspEdgeProvider } from "./lsp/cpp-lsp-edge-provider.js";
import { JavaLspEdgeProvider } from "./lsp/java-lsp-edge-provider.js";
import { CsharpLspEdgeProvider } from "./lsp/csharp-lsp-edge-provider.js";
import { PhpLspEdgeProvider } from "./lsp/php-lsp-edge-provider.js";
import { RubyLspEdgeProvider } from "./lsp/ruby-lsp-edge-provider.js";
import { SemanticDecisionValidator } from "./semantic/semantic-decision-validator.js";
import { acquireProcessLock } from "./process/process-lock.js";

export interface CoreRegistrationOptions {
  /** Composition seam used to preserve/test the one-shared-pool lifetime without constructing
   *  the worker pool during the synchronous registration/bootstrap phase. */
  createAstWorkerPool?: () => IASTWorkerPool;
}

/**
 * Registers the Domain Core's providers into a factory.
 *
 * The default call at the bottom of this module preserves the implementation library's normal
 * self-registration side effect (see
 * docs/gitbook/architecture/application-lifecycle-and-state.md's Bootstrap phase). Accepting an
 * explicit factory is a composition-root seam: Phase 8 can prove registration completeness and
 * lifetime semantics against an isolated factory without resetting/re-importing the global
 * singleton.
 *
 * No generic annotations are required at registration sites — each `TOKENS.X` value carries its
 * own return/params types (see `tokens.ts`'s `Token<T, P>`), so `register()` infers everything and
 * rejects a provider whose shape doesn't match the token at compile time.
 */
export function registerCoreProviders(
  factory: DocuviaFactory = docuviaFactory,
  options: CoreRegistrationOptions = {},
): void {
  const createAstWorkerPool =
    options.createAstWorkerPool ?? (() => new AstWorkerPool());

  factory.register(
    TOKENS.KnowledgeGitService,
    (f, params) =>
      new KnowledgeGitService(
        f.resolve(TOKENS.GitProvider),
        params?.logger,
        params?.gitNetworkTimeoutMs,
      ),
  );

  factory.register(
    TOKENS.FileDiscovery,
    (f, params) =>
      new FileDiscoveryService(f.resolve(TOKENS.GitProvider), params?.logger),
  );

  factory.register(
    TOKENS.ConfigScanner,
    (_f, params) => new ConfigScannerService(params?.logger),
  );

  factory.register(
    TOKENS.VcsScanner,
    (f, params) =>
      new VcsScannerService(f.resolve(TOKENS.GitProvider), params?.logger),
  );

  // One shared worker pool for this registration scope: every transient AstProcessingService
  // resolved from the same factory runs through the SAME pool, so serializeBatch() governs
  // spawn/concurrency across workflows. The pool itself is deliberately lazy: Bootstrap only
  // registers constructors; the first orchestration resolve enters the Instantiate phase and
  // creates the pool. This keeps the anti-worker-multiplication invariant without constructing a
  // heavy resource as a module-level registration side effect.
  let sharedAstWorkerPool: IASTWorkerPool | undefined;
  factory.register(TOKENS.AstProcessor, (_f, params) => {
    sharedAstWorkerPool ??= createAstWorkerPool();
    return new AstProcessingService(sharedAstWorkerPool, params?.logger);
  });

  factory.register(TOKENS.GraphPersister, () => new GraphPersisterService());

  factory.register(
    TOKENS.TempFileManager,
    () => (workspaceRoot, logger) => new TempFileManager(workspaceRoot, logger),
  );

  factory.register(TOKENS.ProcessLock, () => acquireProcessLock);

  factory.register(
    TOKENS.SemanticDecisionValidator,
    () => new SemanticDecisionValidator(),
  );

  factory.register(
    TOKENS.QueryService,
    (_f, params) => new QueryService(params?.logger),
  );

  factory.register(TOKENS.TierBCoverageHintProvider, () => ({
    resolve: resolveTierBCoverageHint,
  }));

  factory.register(
    TOKENS.ImpactService,
    (_f, params) => new ImpactService(params?.logger),
  );

  factory.register(
    TOKENS.ChangeDetectionService,
    (f, params) =>
      new ChangeDetectionService(
        f.resolve(TOKENS.ImpactService, params),
        params?.logger,
      ),
  );

  factory.register(TOKENS.TopologyBuilder, () => new TopologyBuilderService());

  factory.register(
    TOKENS.SnapshotRenderer,
    () => new SnapshotRendererService(),
  );

  factory.register(
    TOKENS.HydrationService,
    (f, params) =>
      new HydrationService(f.resolve(TOKENS.GitProvider), params?.logger),
  );

  factory.register(
    TOKENS.SemanticDiffAnalyzer,
    (_f, params) => new SemanticDiffAnalyzerService(params?.logger),
  );

  factory.register(TOKENS.EdgeResolutionProviders, (_f, params) => ({
    typescript: () => new TypescriptLspEdgeProvider(params?.logger),
    python: () => new PythonLspEdgeProvider(params?.logger),
    go: () => new GoLspEdgeProvider(params?.logger),
    rust: () => new RustLspEdgeProvider(params?.logger),
    cpp: () => new CppLspEdgeProvider(params?.logger),
    java: () => new JavaLspEdgeProvider(params?.logger),
    csharp: () => new CsharpLspEdgeProvider(params?.logger),
    php: () => new PhpLspEdgeProvider(params?.logger),
    ruby: () => new RubyLspEdgeProvider(params?.logger),
  }));
}

registerCoreProviders();
