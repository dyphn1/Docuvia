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
import { EdgeResolutionSources, createNoopLogger } from "@workspace/contracts";
import { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolveLspBinary } from "./lsp-binary-resolver.js";
import { checkLspPreflight } from "./lsp-preflight.js";
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

const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
};

function languageIdFor(filePath: string): string {
  return LANGUAGE_ID_BY_EXTENSION[path.extname(filePath)] ?? "typescript";
}

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

export class TypescriptLspEdgeProvider implements IEdgeResolutionProvider {
  public readonly name = "typescript-language-server";
  private config: EdgeResolutionProviderConfig = {};
  private readonly logger: ILogger;
  private readonly createClient: () => LspJsonRpcClient;

  /** `clientFactory` is a test seam (defaults to a real `LspJsonRpcClient` per batch, per §8b's
   *  spawn-per-batch orchestration model) — tests inject a fake client to exercise this class's
   *  cross-file edge-resolution logic without spawning a real process. */
  constructor(
    logger?: ILogger,
    clientFactory: () => LspJsonRpcClient = () => new LspJsonRpcClient(),
  ) {
    this.logger = logger ?? createNoopLogger();
    this.createClient = clientFactory;
  }

  configure(config: EdgeResolutionProviderConfig): void {
    this.config = config;
  }

  async checkAvailability(
    workspaceRoot: string,
  ): Promise<EdgeResolutionAvailability> {
    const preflight = await checkLspPreflight(workspaceRoot, {
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
    const resolved = resolveLspBinary(workspaceRoot, {
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
        this.logger.warn(`Tier B LSP resolution failed for ${file}`, {
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
    const content = await fs.readFile(absolutePath, "utf8");
    const uri = pathToFileURL(absolutePath).toString();

    client.notify(LspMethods.DID_OPEN, {
      textDocument: {
        uri,
        languageId: languageIdFor(relativePath),
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
