import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type {
  EdgeResolutionAvailability,
  EdgeResolutionOutcome,
  EdgeResolutionProviderConfig,
  EdgeResolutionRequest,
  IEdgeResolutionProvider,
  ResolvedCallEdge,
  ILogger,
} from "@workspace/contracts";
import {
  EdgeResolutionSources,
  createNoopLogger,
  UTF8_ENCODING,
} from "@workspace/contracts";
import { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import type { ResolvedLspBinary } from "./lsp-binary-resolver.js";
import { LspMethods, LspSymbolKinds, LSP_MESSAGES } from "./lsp-constants.js";
import type {
  LspDocumentSymbol,
  LspPosition,
  LspRange,
  LspSymbolInformation,
} from "./lsp-protocol-types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;

const CALL_SITE_KINDS: ReadonlySet<number> = new Set([
  LspSymbolKinds.FUNCTION,
  LspSymbolKinds.METHOD,
  LspSymbolKinds.CONSTRUCTOR,
  LspSymbolKinds.CLASS,
]);

function toNodeKey(relativePath: string): string {
  return relativePath.split("\\").join("/");
}

function isSymbolInformation(
  symbol: LspDocumentSymbol | LspSymbolInformation,
): symbol is LspSymbolInformation {
  return "location" in symbol;
}

function normalizeDocumentSymbols(
  raw: (LspDocumentSymbol | LspSymbolInformation)[] | null | undefined,
): LspDocumentSymbol[] {
  if (!raw) return [];
  return raw.map((symbol) =>
    isSymbolInformation(symbol)
      ? {
          name: symbol.name,
          kind: symbol.kind,
          range: symbol.location.range,
          selectionRange: symbol.location.range,
        }
      : symbol,
  );
}

function containsPosition(range: LspRange, position: LspPosition): boolean {
  const afterStart =
    position.line > range.start.line ||
    (position.line === range.start.line &&
      position.character >= range.start.character);
  const beforeEnd =
    position.line < range.end.line ||
    (position.line === range.end.line &&
      position.character <= range.end.character);
  return afterStart && beforeEnd;
}

function findDeepestContainingSymbol(
  symbols: LspDocumentSymbol[],
  position: LspPosition,
): LspDocumentSymbol | undefined {
  for (const symbol of symbols) {
    if (!containsPosition(symbol.range, position)) continue;
    const child = symbol.children
      ? findDeepestContainingSymbol(symbol.children, position)
      : undefined;
    return child ?? symbol;
  }
  return undefined;
}

function flattenCallSiteSymbols(
  symbols: LspDocumentSymbol[],
): LspDocumentSymbol[] {
  const result: LspDocumentSymbol[] = [];
  for (const symbol of symbols) {
    if (CALL_SITE_KINDS.has(symbol.kind)) result.push(symbol);
    if (symbol.children)
      result.push(...flattenCallSiteSymbols(symbol.children));
  }
  return result;
}

interface OpenFileHandle {
  relativePath: string;
  uri: string;
  symbols: LspDocumentSymbol[];
}

/**
 * Minimal preflight outcome shape `BaseLspEdgeProvider` actually needs (`ready`/`reason`) --
 * each language's own preflight function (`lsp-preflight.ts` for TS, `python-lsp-preflight.ts`
 * for Python, ...) is free to return a richer, language-specific result object (e.g. TS's
 * `LspPreflightResult` with its own `nodeModulesPresent`/`tsconfigResolvable` fields) as long as
 * it's a structural superset of this -- keeps `LspLanguageConfig.checkPreflight`'s signature
 * language-agnostic instead of tied to TS's own marker-file vocabulary.
 */
export interface LspPreflightOutcome {
  ready: boolean;
  /** Set when `ready` is `false` -- the first failing check, human-readable. */
  reason?: string;
}

/**
 * Per-language config a BaseLspEdgeProvider needs (multi-language-lsp-support plan, Finding B):
 * everything TypescriptLspEdgeProvider's batch/reference-resolution logic used to hardcode as
 * TS-specific (its binary resolution and pre-flight checks) plus the textDocument/didOpen
 * languageId map, extracted out so the same base class can drive any language's LSP server.
 */
export interface LspLanguageConfig {
  /** The provider's name field (e.g. typescript-language-server, pyright). */
  name: string;
  /** LSP textDocument/didOpen's languageId values, keyed by source extension. */
  languageIdByExtension: Record<string, string>;
  /** Used for any extension not present in languageIdByExtension (should not normally happen,
   *  since callers only ever pass files this language's Tier B dispatch entry already matched). */
  defaultLanguageId: string;
  resolveBinary: (
    workspaceRoot: string,
    override?: { binary?: string; args?: string[] },
  ) => ResolvedLspBinary | Promise<ResolvedLspBinary>;
  checkPreflight: (
    workspaceRoot: string,
    override?: { binary?: string; args?: string[] },
  ) => Promise<LspPreflightOutcome>;
}

/**
 * Generic LSP batch/reference-resolution logic (multi-language-lsp-support plan, Finding B),
 * extracted verbatim from TypescriptLspEdgeProvider -- it only ever called standard LSP methods
 * (initialize, textDocument/didOpen, textDocument/documentSymbol, textDocument/references,
 * shutdown, exit) and standard SymbolKind numbers, so nothing here is TS-specific. Each language's
 * provider is a thin IEdgeResolutionProvider that supplies its own LspLanguageConfig to this base
 * class.
 */
export class BaseLspEdgeProvider implements IEdgeResolutionProvider {
  public readonly name: string;
  private config: EdgeResolutionProviderConfig = {};
  private readonly logger: ILogger;
  private readonly createClient: () => LspJsonRpcClient;
  private readonly languageConfig: LspLanguageConfig;

  /** clientFactory is a test seam (defaults to a real LspJsonRpcClient per batch, per Section 8b's
   *  spawn-per-batch orchestration model) -- tests inject a fake client to exercise this class's
   *  cross-file edge-resolution logic without spawning a real process. */
  constructor(
    languageConfig: LspLanguageConfig,
    logger?: ILogger,
    clientFactory: () => LspJsonRpcClient = () => new LspJsonRpcClient(),
  ) {
    this.languageConfig = languageConfig;
    this.name = languageConfig.name;
    this.logger = logger ?? createNoopLogger();
    this.createClient = clientFactory;
  }

  configure(config: EdgeResolutionProviderConfig): void {
    this.config = config;
  }

  async checkAvailability(
    workspaceRoot: string,
  ): Promise<EdgeResolutionAvailability> {
    const preflight = await this.languageConfig.checkPreflight(workspaceRoot, {
      binary: this.config.binaryOverride,
      args: this.config.argsOverride,
    });
    return preflight.ready
      ? { available: true }
      : { available: false, reason: preflight.reason };
  }

  async resolveEdges(
    request: EdgeResolutionRequest,
  ): Promise<EdgeResolutionOutcome> {
    if (request.files.length === 0) {
      return { edges: [], filesProcessed: [], filesFailed: [] };
    }

    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return this.runWithTimeout(request, timeoutMs);
  }

  private languageIdFor(filePath: string): string {
    return (
      this.languageConfig.languageIdByExtension[path.extname(filePath)] ??
      this.languageConfig.defaultLanguageId
    );
  }

  private async runWithTimeout(
    request: EdgeResolutionRequest,
    timeoutMs: number,
  ): Promise<EdgeResolutionOutcome> {
    const client = this.createClient();
    let timedOut = false;
    const timeoutPromise = new Promise<EdgeResolutionOutcome>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        resolve({
          edges: [],
          filesProcessed: [],
          filesFailed: [],
          unavailableReason: LSP_MESSAGES.batchTimedOut(timeoutMs),
        });
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      return await Promise.race([
        this.runBatch(client, request),
        timeoutPromise,
      ]);
    } finally {
      if (timedOut) await client.stop().catch(() => undefined);
    }
  }

  private async runBatch(
    client: LspJsonRpcClient,
    request: EdgeResolutionRequest,
  ): Promise<EdgeResolutionOutcome> {
    const { workspaceRoot, files } = request;
    const resolved = await this.languageConfig.resolveBinary(workspaceRoot, {
      binary: this.config.binaryOverride,
      args: this.config.argsOverride,
    });

    try {
      await client.start({
        command: resolved.command,
        args: resolved.args,
        cwd: workspaceRoot,
      });
    } catch (err) {
      return {
        edges: [],
        filesProcessed: [],
        filesFailed: [],
        unavailableReason: LSP_MESSAGES.spawnFailed(
          resolved.command,
          err instanceof Error ? err.message : String(err),
        ),
      };
    }

    try {
      await this.initializeSession(client, workspaceRoot);
    } catch (err) {
      // The process spawned (the try/catch above didn't fire) but exited/errored before
      // completing the `initialize` handshake -- e.g. `npx --no-install <pkg>` starting
      // successfully as a process, then exiting because the package isn't cached (confirmed via
      // a real `pyright-langserver` spawn during the multi-language-lsp-support plan's Slice 1;
      // pre-existing gap, not Python-specific -- any npx/npm-fallback language can hit this).
      // Per `IEdgeResolutionProvider.resolveEdges()`'s own contract ("never throws for an
      // ordinary unavailable ... outcome"), this must degrade honestly, not propagate.
      await this.shutdownSession(client);
      return {
        edges: [],
        filesProcessed: [],
        filesFailed: [],
        unavailableReason: LSP_MESSAGES.initializeFailed(
          err instanceof Error ? err.message : String(err),
        ),
      };
    }

    try {
      return await this.processAllFiles(client, workspaceRoot, files);
    } finally {
      await this.shutdownSession(client);
    }
  }

  private async initializeSession(
    client: LspJsonRpcClient,
    workspaceRoot: string,
  ): Promise<void> {
    const rootUri = pathToFileURL(workspaceRoot).toString();
    await client.request(
      LspMethods.INITIALIZE,
      {
        processId: process.pid,
        rootUri,
        capabilities: {},
        workspaceFolders: [
          { uri: rootUri, name: path.basename(workspaceRoot) },
        ],
      },
      REQUEST_TIMEOUT_MS,
    );
    client.notify(LspMethods.INITIALIZED, {});
  }

  private async shutdownSession(client: LspJsonRpcClient): Promise<void> {
    try {
      await client.request(LspMethods.SHUTDOWN, null, REQUEST_TIMEOUT_MS);
      client.notify(LspMethods.EXIT, {});
    } catch {
      // best-effort teardown
    } finally {
      await client.stop();
    }
  }

  private async processAllFiles(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    files: string[],
  ): Promise<EdgeResolutionOutcome> {
    const edges: ResolvedCallEdge[] = [];
    const edgeKeys = new Set<string>();
    const filesProcessed: string[] = [];
    const filesFailed: EdgeResolutionOutcome["filesFailed"] = [];
    const openFileCache = new Map<string, OpenFileHandle>();

    for (const file of files) {
      try {
        const fileEdges = await this.processOneFile(
          client,
          workspaceRoot,
          file,
          openFileCache,
        );
        for (const edge of fileEdges) {
          const key = `${edge.sourceNodeKey}->${edge.targetNodeKey}`;
          if (edgeKeys.has(key)) continue;
          edgeKeys.add(key);
          edges.push(edge);
        }
        filesProcessed.push(file);
      } catch (err) {
        filesFailed.push({
          file,
          reason: err instanceof Error ? err.message : String(err),
        });
        this.logger.warn(LSP_MESSAGES.resolutionFailedForFile(file), {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { edges, filesProcessed, filesFailed };
  }

  private async processOneFile(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    relativePath: string,
    openFileCache: Map<string, OpenFileHandle>,
  ): Promise<ResolvedCallEdge[]> {
    const callee = await this.openAndGetSymbols(
      client,
      workspaceRoot,
      relativePath,
      openFileCache,
    );
    const callSiteSymbols = flattenCallSiteSymbols(callee.symbols);

    const edges: ResolvedCallEdge[] = [];
    for (const symbol of callSiteSymbols) {
      const references = await client.request<
        { uri: string; range: LspRange }[]
      >(
        LspMethods.REFERENCES,
        {
          textDocument: { uri: callee.uri },
          position: symbol.selectionRange.start,
          context: { includeDeclaration: false },
        },
        REQUEST_TIMEOUT_MS,
      );
      const calleeNodeKey = toNodeKey(`${relativePath}#${symbol.name}`);
      for (const ref of references ?? []) {
        const edge = await this.resolveReferenceEdge(
          client,
          workspaceRoot,
          ref,
          calleeNodeKey,
          relativePath,
          openFileCache,
        );
        if (edge) edges.push(edge);
      }
    }
    return edges;
  }

  private async resolveReferenceEdge(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    ref: { uri: string; range: LspRange },
    calleeNodeKey: string,
    calleeFile: string,
    openFileCache: Map<string, OpenFileHandle>,
  ): Promise<ResolvedCallEdge | undefined> {
    const refPath = path.relative(workspaceRoot, fileURLToPath(ref.uri));
    const refRelative = toNodeKey(refPath);
    if (refRelative === calleeFile) return undefined;

    const caller = await this.openAndGetSymbols(
      client,
      workspaceRoot,
      refRelative,
      openFileCache,
    );
    const enclosing = findDeepestContainingSymbol(
      caller.symbols,
      ref.range.start,
    );
    const sourceNodeKey =
      enclosing && CALL_SITE_KINDS.has(enclosing.kind)
        ? toNodeKey(`${refRelative}#${enclosing.name}`)
        : refRelative;

    return {
      sourceNodeKey,
      targetNodeKey: calleeNodeKey,
      source: EdgeResolutionSources.LSP,
    };
  }

  private async openAndGetSymbols(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    relativePath: string,
    cache: Map<string, OpenFileHandle>,
  ): Promise<OpenFileHandle> {
    const cached = cache.get(relativePath);
    if (cached) return cached;

    const absolutePath = path.join(workspaceRoot, relativePath);
    const content = await fs.readFile(absolutePath, UTF8_ENCODING);
    const uri = pathToFileURL(absolutePath).toString();

    client.notify(LspMethods.DID_OPEN, {
      textDocument: {
        uri,
        languageId: this.languageIdFor(relativePath),
        version: 1,
        text: content,
      },
    });

    const raw = await client.request<
      (LspDocumentSymbol | LspSymbolInformation)[] | null
    >(
      LspMethods.DOCUMENT_SYMBOL,
      { textDocument: { uri } },
      REQUEST_TIMEOUT_MS,
    );
    const symbols = normalizeDocumentSymbols(raw);

    const handle: OpenFileHandle = { relativePath, uri, symbols };
    cache.set(relativePath, handle);
    return handle;
  }
}
