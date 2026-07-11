import {
  docuviaFactory,
  TOKENS,
  type IAstProcessor,
  type IConfigScanner,
  type IFileDiscovery,
  type IGitProvider,
  type IGraphPersister,
  type IKnowledgeGitService,
  type ILogger,
  type ITempFileManager,
  type IVcsScanner,
} from "@workspace/contracts";
import { KnowledgeGitService } from "./git/knowledge-git.service.js";
import { FileDiscoveryService } from "./discovery/file-discovery.service.js";
import { ConfigScannerService } from "./discovery/config-scanner.service.js";
import { VcsScannerService } from "./discovery/vcs-scanner.service.js";
import { AstProcessingService } from "./ast/ast-processing.service.js";
import { AstWorkerPool } from "./ast/ast-worker-pool.js";
import { GraphPersisterService } from "./graph/persist-ast-graph.js";
import { TempFileManager } from "./temp-files/temp-file-manager.js";

/**
 * Self-registration side effect (see
 * docs/gitbook/architecture/application-lifecycle-and-state.md's Bootstrap phase) — imported
 * once, for its side effect only, by the Presentation layer. `lib/ui-core` never imports these
 * concrete classes directly; it only resolves them by token and sees the associated interface.
 *
 * Every provider takes an optional `{ logger }` param — the per-run logger is never resolved
 * from the factory (it's request-scoped, not swappable tech), so the Orchestration layer passes
 * it explicitly on every `resolve()` call.
 */
type LoggerParams = { logger?: ILogger };

docuviaFactory.register<IKnowledgeGitService, LoggerParams>(TOKENS.KnowledgeGitService, (f, params) =>
  new KnowledgeGitService(f.resolve<IGitProvider>(TOKENS.GitProvider), params?.logger)
);

docuviaFactory.register<IFileDiscovery, LoggerParams>(TOKENS.FileDiscovery, (f, params) =>
  new FileDiscoveryService(f.resolve<IGitProvider>(TOKENS.GitProvider), params?.logger)
);

docuviaFactory.register<IConfigScanner, LoggerParams>(TOKENS.ConfigScanner, (_f, params) =>
  new ConfigScannerService(params?.logger)
);

docuviaFactory.register<IVcsScanner, LoggerParams>(TOKENS.VcsScanner, (f, params) =>
  new VcsScannerService(f.resolve<IGitProvider>(TOKENS.GitProvider), params?.logger)
);

docuviaFactory.register<IAstProcessor, LoggerParams>(TOKENS.AstProcessor, (_f, params) =>
  new AstProcessingService(new AstWorkerPool(params?.logger), params?.logger)
);

docuviaFactory.register<IGraphPersister>(TOKENS.GraphPersister, () => new GraphPersisterService());

docuviaFactory.register<(workspaceRoot: string, logger?: ILogger) => ITempFileManager>(
  TOKENS.TempFileManager,
  () => (workspaceRoot, logger) => new TempFileManager(workspaceRoot, logger)
);
