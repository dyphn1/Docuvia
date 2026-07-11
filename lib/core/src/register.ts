import { docuviaFactory, TOKENS } from "@workspace/contracts";
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
 * No generic annotations here — each `TOKENS.X` value carries its own return/params types (see
 * `tokens.ts`'s `Token<T, P>`), so `register()` infers everything and rejects a provider whose
 * shape doesn't match the token at compile time (see
 * docs/gitbook/architecture/virtual-contracts-architecture.md#8).
 *
 * Every provider takes an optional `{ logger }` param — the per-run logger is never resolved
 * from the factory (it's request-scoped, not swappable tech), so the Orchestration layer passes
 * it explicitly on every `resolve()` call.
 */
docuviaFactory.register(TOKENS.KnowledgeGitService, (f, params) =>
  new KnowledgeGitService(f.resolve(TOKENS.GitProvider), params?.logger)
);

docuviaFactory.register(TOKENS.FileDiscovery, (f, params) =>
  new FileDiscoveryService(f.resolve(TOKENS.GitProvider), params?.logger)
);

docuviaFactory.register(TOKENS.ConfigScanner, (_f, params) =>
  new ConfigScannerService(params?.logger)
);

docuviaFactory.register(TOKENS.VcsScanner, (f, params) =>
  new VcsScannerService(f.resolve(TOKENS.GitProvider), params?.logger)
);

docuviaFactory.register(TOKENS.AstProcessor, (_f, params) =>
  new AstProcessingService(new AstWorkerPool(params?.logger), params?.logger)
);

docuviaFactory.register(TOKENS.GraphPersister, () => new GraphPersisterService());

docuviaFactory.register(
  TOKENS.TempFileManager,
  () => (workspaceRoot, logger) => new TempFileManager(workspaceRoot, logger)
);
