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
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const CALL_SITE_KINDS: ReadonlySet<number> = new Set([
  LspSymbolKinds.FUNCTION,
  LspSymbolKinds.METHOD,
  LspSymbolKinds.CONSTRUCTOR,
  LspSymbolKinds.CLASS,
]);

function toNodeKey(relativePath: string): string {
  return relativePath.split("\\").join("/");
}

/** Distinguishes "the whole-batch deadline ran out mid-file" (`raceAgainstDeadline`) from an
 *  ordinary per-file processing error inside `processAllFiles`'s catch block -- both currently
 *  land in the same `filesFailed` channel, but only the former should also flip the batch-level
 *  `deadlineExceeded`/`unavailableReason` flag. */
class DeadlineExceededError extends Error {}

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

  /** Per-LSP-request timeout (`initialize`/`documentSymbol`/`references`/`shutdown`) — shares
   *  `config.timeoutMs` with the whole-batch cap below rather than a second config field, since
   *  the caller-facing knob is "how long am I willing to wait for this LSP server", not two
   *  independently-tunable numbers. `0` means "never time out" (csharp-ls on a large
   *  Roslyn/MSBuild solution can take longer than any fixed guess to answer even one request —
   *  see csharp-cli-benchmark.md §4). */
  private get requestTimeoutMs(): number {
    return this.config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
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
    const client = this.createClient();
    return this.runBatch(client, request, timeoutMs);
  }

  private languageIdFor(filePath: string): string {
    return (
      this.languageConfig.languageIdByExtension[path.extname(filePath)] ??
      this.languageConfig.defaultLanguageId
    );
  }

  private async runBatch(
    client: LspJsonRpcClient,
    request: EdgeResolutionRequest,
    timeoutMs: number,
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

    // `0` means "always wait" -- e.g. csharp-ls on a large Roslyn/MSBuild solution has no known
    // upper bound on workspace-load time. A deadline of `Date.now() + 0` would immediately trip,
    // the opposite of what's wanted, so skip deadline-tracking entirely rather than special-casing
    // the value.
    const deadlineAt = timeoutMs > 0 ? Date.now() + timeoutMs : undefined;

    try {
      return await this.processAllFiles(
        client,
        workspaceRoot,
        files,
        deadlineAt,
        timeoutMs,
      );
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
      this.requestTimeoutMs,
    );
    client.notify(LspMethods.INITIALIZED, {});
  }

  private async shutdownSession(client: LspJsonRpcClient): Promise<void> {
    try {
      await client.request(LspMethods.SHUTDOWN, null, this.requestTimeoutMs);
      client.notify(LspMethods.EXIT, {});
    } catch {
      // best-effort teardown
    } finally {
      await client.stop();
    }
  }

  /**
   * Drains `files` one at a time, stopping cooperatively once `deadlineAt` passes -- rather than
   * `Promise.race`-ing the *whole batch* against a single timer (the pre-fix design), which threw
   * away every file already successfully processed the instant the timer won, even if 999/1000
   * files had real edges resolved (2026-07 CLI benchmark finding, C# Tier B against a large
   * Orleans solution). Files never reached before the deadline, and the one in flight when it
   * trips (via `raceAgainstDeadline` below -- a per-file guard, since a single hung
   * `processOneFile` would otherwise blow the whole remaining budget), are reported through the
   * same `filesFailed` channel an ordinary per-file error already uses, so
   * `finalizeBatch`/`applyResolvedEdges` (`run-tier-b-batch.ts`) can restage exactly the unreached
   * files instead of the entire original batch. `unavailableReason` is still set when the deadline
   * actually tripped -- distinct from an ordinary per-file failure -- so callers keep treating a
   * timed-out run as degraded (exit code, doctor's log scan) even though some real work survived.
   */
  private async processAllFiles(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    files: string[],
    deadlineAt: number | undefined,
    timeoutMs: number,
  ): Promise<EdgeResolutionOutcome> {
    const edges: ResolvedCallEdge[] = [];
    const edgeKeys = new Set<string>();
    const filesProcessed: string[] = [];
    const filesFailed: EdgeResolutionOutcome["filesFailed"] = [];
    const openFileCache = new Map<string, OpenFileHandle>();
    let deadlineExceeded = false;

    for (const file of files) {
      const remainingMs =
        deadlineAt !== undefined ? deadlineAt - Date.now() : undefined;
      if (remainingMs !== undefined && remainingMs <= 0) {
        deadlineExceeded = true;
        break;
      }

      try {
        const fileEdges =
          remainingMs !== undefined
            ? await this.raceAgainstDeadline(
                this.processOneFile(client, workspaceRoot, file, openFileCache),
                remainingMs,
              )
            : await this.processOneFile(
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
        if (err instanceof DeadlineExceededError) {
          deadlineExceeded = true;
          filesFailed.push({
            file,
            reason: LSP_MESSAGES.batchTimedOut(timeoutMs),
          });
          break;
        }
        filesFailed.push({
          file,
          reason: err instanceof Error ? err.message : String(err),
        });
        this.logger.warn(LSP_MESSAGES.resolutionFailedForFile(file), {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (deadlineExceeded) {
      const reached = new Set([
        ...filesProcessed,
        ...filesFailed.map((f) => f.file),
      ]);
      for (const file of files) {
        if (!reached.has(file)) {
          filesFailed.push({
            file,
            reason: LSP_MESSAGES.batchTimedOut(timeoutMs),
          });
        }
      }
    }

    return {
      edges,
      filesProcessed,
      filesFailed,
      ...(deadlineExceeded
        ? { unavailableReason: LSP_MESSAGES.batchTimedOut(timeoutMs) }
        : {}),
    };
  }

  /** Races a single file's processing against however much of the whole-batch deadline is left,
   *  rejecting with `DeadlineExceededError` (never resolving the underlying promise itself -- the
   *  file's in-flight LSP requests are abandoned, matching the pre-fix behavior of stopping the
   *  client out from under them, just now scoped to one file instead of the whole batch) so
   *  `processAllFiles` can tell "this file itself failed" apart from "the budget ran out mid-file"
   *  and stop cleanly rather than start a doomed next file. */
  private raceAgainstDeadline<T>(
    promise: Promise<T>,
    remainingMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new DeadlineExceededError()),
        remainingMs,
      );
      timer.unref?.();
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
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
        this.requestTimeoutMs,
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
      this.requestTimeoutMs,
    );
    const symbols = normalizeDocumentSymbols(raw);

    const handle: OpenFileHandle = { relativePath, uri, symbols };
    cache.set(relativePath, handle);
    return handle;
  }
}
