import type { ILogger } from "../logging/types.js";
import type { IGitProvider } from "../interfaces/git.interfaces.js";
import type { IKnowledgeGitService } from "../interfaces/knowledge-git.interfaces.js";
import type {
  IConfigScanner,
  IFileDiscovery,
  IVcsScanner,
} from "../interfaces/discovery.interfaces.js";
import type { IAstProcessor } from "../interfaces/ast.interfaces.js";
import type { IGraphPersister } from "../interfaces/graph-persister.interfaces.js";
import type {
  GraphStoreOpenOptions,
  IGraphStore,
} from "../interfaces/graph-store.interfaces.js";
import type { ITempFileManager } from "../interfaces/temp-file-manager.interfaces.js";
import type { IRemoteSyncClient } from "../interfaces/remote-sync.interfaces.js";
import type { ILlmClient } from "../interfaces/llm-client.interfaces.js";
import type { IQueryService } from "../interfaces/query.interfaces.js";
import type { IImpactService } from "../interfaces/impact.interfaces.js";
import type { IChangeDetectionService } from "../interfaces/change-detection.interfaces.js";
import type { ITopologyBuilder } from "../interfaces/topology.interfaces.js";
import type { ISnapshotRenderer } from "../interfaces/snapshot.interfaces.js";
import type { IHydrationService } from "../interfaces/hydration.interfaces.js";
import type { IDiagnosticRunner } from "../interfaces/diagnostic.interfaces.js";
import type { ISemanticDiffAnalyzer } from "../interfaces/semantic-diff.interfaces.js";
import type {
  IEdgeResolutionProvider,
  TierBLanguageId,
} from "../interfaces/edge-resolution.interfaces.js";

/**
 * A phantom-typed registration token — see
 * docs/gitbook/architecture/virtual-contracts-architecture.md#8 (Type-Safe Registry). At
 * runtime this is nothing but a `symbol`; `T`/`P` never hold a real value — they exist purely
 * so `docuviaFactory.register()`/`.resolve()` can infer the provider's return type and params
 * type directly from the token argument, with zero manual generic annotations at any call site
 * and zero possibility of requesting one interface through a differently-typed token.
 */
export type Token<T, P = void> = symbol & {
  readonly __docuviaToken?: { result: T; params: P };
};

/** Creates a token carrying its `T`/`P` as a compile-time-only phantom type. `description` is
 *  only for debugging (shows up in `Symbol#description` / error messages) — it carries no
 *  type information itself. */
export function createToken<T, P = void>(description: string): Token<T, P> {
  return Symbol(description) as Token<T, P>;
}

type LoggerParams = { logger?: ILogger };

/** `KnowledgeGitService`'s params: the shared `logger` plus §"sync-knowledge push timeout"'s
 *  config-tunable override for `fetchRef`/`pushRef`'s network bound (`undefined` — the default —
 *  means "no timeout, wait for the transfer to finish"). */
type KnowledgeGitServiceParams = LoggerParams & {
  gitNetworkTimeoutMs?: number;
};

/**
 * Every registration token in the workspace. This is the single declaration point pairing a
 * token with its interface (and, where relevant, its per-call params shape) — the "register it
 * in the TokenMap" step every new capability goes through. Everywhere else in the codebase,
 * `register()`/`resolve()` infer everything from whichever `TOKENS.X` value is passed in.
 */
export const TOKENS = {
  GitProvider: createToken<IGitProvider>("IGitProvider"),
  KnowledgeGitService: createToken<
    IKnowledgeGitService,
    KnowledgeGitServiceParams
  >("IKnowledgeGitService"),
  FileDiscovery: createToken<IFileDiscovery, LoggerParams>("IFileDiscovery"),
  ConfigScanner: createToken<IConfigScanner, LoggerParams>("IConfigScanner"),
  VcsScanner: createToken<IVcsScanner, LoggerParams>("IVcsScanner"),
  AstProcessor: createToken<IAstProcessor, LoggerParams>("IAstProcessor"),
  GraphPersister: createToken<IGraphPersister>("IGraphPersister"),
  TempFileManager:
    createToken<(workspaceRoot: string, logger?: ILogger) => ITempFileManager>(
      "TempFileManager",
    ),
  GraphStoreOpener:
    createToken<(opts: GraphStoreOpenOptions) => Promise<IGraphStore>>(
      "GraphStoreOpener",
    ),
  /** A builder function, not a shared instance — mirrors `TempFileManager`'s token shape since
   *  construction needs per-run config (`apiUrl`/`pat`) sourced from `docuviaMemory`, not
   *  swappable tech. */
  RemoteSyncClient: createToken<() => IRemoteSyncClient>("RemoteSyncClient"),
  /** A builder function, not a shared instance — mirrors `RemoteSyncClient`'s token shape since
   *  construction needs per-run config (`baseUrl`/`apiKey`) sourced from `docuviaMemory`, not
   *  swappable tech. */
  LlmClient: createToken<() => ILlmClient>("LlmClient"),
  QueryService: createToken<IQueryService, LoggerParams>("IQueryService"),
  ImpactService: createToken<IImpactService, LoggerParams>("IImpactService"),
  ChangeDetectionService: createToken<IChangeDetectionService, LoggerParams>(
    "IChangeDetectionService",
  ),
  TopologyBuilder: createToken<ITopologyBuilder, LoggerParams>(
    "ITopologyBuilder",
  ),
  SnapshotRenderer: createToken<ISnapshotRenderer>("ISnapshotRenderer"),
  HydrationService: createToken<IHydrationService, LoggerParams>(
    "IHydrationService",
  ),
  DiagnosticRunnerDb: createToken<IDiagnosticRunner>("DiagnosticRunnerDb"),
  DiagnosticRunnerGit: createToken<IDiagnosticRunner, LoggerParams>(
    "DiagnosticRunnerGit",
  ),
  SemanticDiffAnalyzer: createToken<ISemanticDiffAnalyzer, LoggerParams>(
    "ISemanticDiffAnalyzer",
  ),
  /** A registry, not a single builder function (multi-language-lsp-support plan, Finding A) — the
   *  `DocuviaFactory` itself stays single-value-per-token, so the *value* behind this one token is
   *  a `Partial<Record<TierBLanguageId, ...>>` map of per-language provider builders. The Tier B
   *  batch resolves this once, looks up the builder for each queued language, then calls
   *  `.configure()` on the built provider with any overrides before using it — exactly like
   *  `ILlmClient.initialize()`, just keyed by language now. Slice 0 registers just `{ typescript }`
   *  (unchanged behavior); later language slices each add one more key. */
  EdgeResolutionProviders: createToken<
    Partial<Record<TierBLanguageId, () => IEdgeResolutionProvider>>,
    LoggerParams
  >("EdgeResolutionProviders"),
} as const;
