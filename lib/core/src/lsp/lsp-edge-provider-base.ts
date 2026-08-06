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
import {
  buildUniqueNodeKey,
  buildQualifiedBaseKey,
} from "../graph/node-key.js";
import type {
  LspDocumentSymbol,
  LspPosition,
  LspRange,
  LspSymbolInformation,
} from "./lsp-protocol-types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Default `maxOpenFiles` cap (see `EdgeResolutionProviderConfig.maxOpenFiles`). Before this cap
 *  existed, `openFileCache` closed a file only once its own turn in the batch queue finished, so
 *  a file opened transitively as some other file's caller stayed open until then -- for a huge
 *  batch (vscode's 12,339-file Tier B queue) that meant the number of simultaneously-open
 *  documents in the LSP server was bounded only by the whole batch size, the suspected cause of
 *  the documented throughput collapse against vscode. Raised 50 → 200 alongside the issue #11
 *  pipelining fix: the original cap predates `maxTsServerMemory`'s 8GB heap bound (which now
 *  contains tsserver's memory regardless of open-document count), and a larger cache keeps files
 *  opened transitively as callers alive across more of the queue, cutting reopen/re-parse churn
 *  for the same re-tune-if-it's-off caveat as before. */
const DEFAULT_MAX_OPEN_FILES = 200;

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
 *  ordinary per-file processing error inside `processOneFileIntoBatch`'s catch block -- both
 *  currently land in the same `filesFailed` channel, but only the former should also flip the
 *  batch-level `deadlineExceeded`/`unavailableReason` flag. */
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

/** A symbol found by `findDeepestContainingSymbol`/`flattenCallSiteSymbols`, alongside the name of
 *  the nearest enclosing `CLASS`-kind ancestor symbol (GRPH-006) -- `undefined` when the symbol
 *  sits at file scope (or its nearest ancestor isn't class-kind). This is Tier B's own containment
 *  read, structurally independent of Tier A's `ast-worker.ts` containerName (both are gated behind
 *  `LspLanguageConfig.supportsQualifiedContainment` before ever reaching a `node_key` -- see
 *  `resolveNodeKeyForFile`). */
interface EnclosedSymbol {
  symbol: LspDocumentSymbol;
  containerName?: string;
}

function findDeepestContainingSymbol(
  symbols: LspDocumentSymbol[],
  position: LspPosition,
  enclosingClassName?: string,
): EnclosedSymbol | undefined {
  for (const symbol of symbols) {
    if (!containsPosition(symbol.range, position)) continue;
    const childEnclosingClassName =
      symbol.kind === LspSymbolKinds.CLASS ? symbol.name : enclosingClassName;
    const child = symbol.children
      ? findDeepestContainingSymbol(
          symbol.children,
          position,
          childEnclosingClassName,
        )
      : undefined;
    return child ?? { symbol, containerName: enclosingClassName };
  }
  return undefined;
}

function flattenCallSiteSymbols(
  symbols: LspDocumentSymbol[],
  enclosingClassName?: string,
): EnclosedSymbol[] {
  const result: EnclosedSymbol[] = [];
  for (const symbol of symbols) {
    if (CALL_SITE_KINDS.has(symbol.kind))
      result.push({ symbol, containerName: enclosingClassName });
    if (symbol.children) {
      const childEnclosingClassName =
        symbol.kind === LspSymbolKinds.CLASS ? symbol.name : enclosingClassName;
      result.push(
        ...flattenCallSiteSymbols(symbol.children, childEnclosingClassName),
      );
    }
  }
  return result;
}

interface OpenFileHandle {
  relativePath: string;
  uri: string;
  symbols: LspDocumentSymbol[];
}

/** Per-file node_key disambiguation state, batch-scoped -- see `resolveNodeKeyForFile`. */
type UsedNodeKeysByFile = Map<
  string,
  { used: Set<string>; resolved: Map<string, string> }
>;

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
  /** GRPH-006: whether this language's Tier A extraction resolves method-in-class containment
   *  (mirrors `ast-worker.ts`'s actual per-language capability — see the plan's capability table.
   *  Deliberately explicit, never inferred from the LSP server's own `documentSymbol` nesting,
   *  which is semantic and may disagree with Tier A's tree-sitter-ancestry rule per language. */
  supportsQualifiedContainment: boolean;
  /** Sent verbatim as the `initialize` request's `initializationOptions` param (LSP spec: an
   *  opaque, server-defined bag -- most servers ignore fields they don't recognize, so this is
   *  safe to leave unset for any language with nothing to configure here). TS/JS uses this to set
   *  `maxTsServerMemory` (roadmap item 28) -- `typescript-language-server` reads it directly off
   *  `params.initializationOptions.maxTsServerMemory` and forwards it as tsserver's own
   *  `--max-old-space-size` arg (confirmed by reading that package's own source,
   *  `lib/cli.mjs`'s `TsServerProcessFactory.fork`/`createTsServerRequestExecutor`). */
  initializationOptions?: Record<string, unknown>;
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

  /** See `DEFAULT_MAX_OPEN_FILES`/`EdgeResolutionProviderConfig.maxOpenFiles`. */
  private get maxOpenFiles(): number {
    return this.config.maxOpenFiles ?? DEFAULT_MAX_OPEN_FILES;
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
        env: resolved.env,
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
        // `hierarchicalDocumentSymbolSupport` MUST be declared true here, or a spec-compliant
        // server (confirmed live against gopls v0.23.0 -- go-cli-benchmark.md §3.1) answers
        // `textDocument/documentSymbol` with the flat, older `SymbolInformation[]` shape instead
        // of `DocumentSymbol[]`. `normalizeDocumentSymbols` then aliases `selectionRange` to
        // `location.range`, whose `start` is the *declaration's* start (e.g. a function's `func`
        // keyword) rather than its identifier's -- `textDocument/references` at that position
        // fails outright (gopls: "no identifier found") for every symbol whose declaration
        // doesn't happen to start exactly on its name (structs/types often do by coincidence,
        // which is why 3/98 files "worked" in the gin benchmark run while every function/method
        // failed). Not Go-specific in principle -- every language here shares this same empty
        // `capabilities: {}`, and only gopls's stricter spec adherence made the gap observable.
        capabilities: {
          textDocument: {
            documentSymbol: {
              hierarchicalDocumentSymbolSupport: true,
            },
          },
        },
        workspaceFolders: [
          { uri: rootUri, name: path.basename(workspaceRoot) },
        ],
        ...(this.languageConfig.initializationOptions
          ? { initializationOptions: this.languageConfig.initializationOptions }
          : {}),
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
    // Batch-scoped (not per-`processOneFile`-call): a symbol's file can be touched both as a
    // callee (this loop) and as some other callee's caller file (`resolveReferenceEdge`), so
    // disambiguation state for a given file must stay consistent across both paths, not reset
    // per call -- see `resolveNodeKeyForFile`.
    const usedNodeKeysByFile: UsedNodeKeysByFile = new Map();
    let deadlineExceeded = false;

    for (const file of files) {
      const remainingMs =
        deadlineAt !== undefined ? deadlineAt - Date.now() : undefined;
      if (remainingMs !== undefined && remainingMs <= 0) {
        deadlineExceeded = true;
        break;
      }

      const result = await this.processOneFileIntoBatch(
        client,
        workspaceRoot,
        file,
        openFileCache,
        usedNodeKeysByFile,
        edges,
        edgeKeys,
        filesProcessed,
        filesFailed,
        remainingMs,
        timeoutMs,
      );
      if (!result.ok && result.deadlineExceeded) {
        deadlineExceeded = true;
        break;
      }
    }

    if (deadlineExceeded) {
      this.markUnreachedFilesFailed(
        files,
        filesProcessed,
        filesFailed,
        timeoutMs,
      );
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

  /** One iteration of `processAllFiles`'s per-file loop body, pulled out purely to keep
   *  `processAllFiles`'s own cyclomatic complexity down -- the race-against-deadline/no-race
   *  ternary, the catch's deadline-vs-ordinary-failure split, and the edge dedup loop all still
   *  behave exactly as before, just under this name. Pushes onto `filesProcessed`/`filesFailed`/
   *  `edges` in place (same batch-scoped accumulators `processAllFiles` owns) since the caller only
   *  needs to know whether to `break` and flip `deadlineExceeded` -- not re-derive what happened. */
  private async processOneFileIntoBatch(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    file: string,
    openFileCache: Map<string, OpenFileHandle>,
    usedNodeKeysByFile: UsedNodeKeysByFile,
    edges: ResolvedCallEdge[],
    edgeKeys: Set<string>,
    filesProcessed: string[],
    filesFailed: EdgeResolutionOutcome["filesFailed"],
    remainingMs: number | undefined,
    timeoutMs: number,
  ): Promise<{ ok: true } | { ok: false; deadlineExceeded: boolean }> {
    try {
      const fileEdges =
        remainingMs !== undefined
          ? await this.raceAgainstDeadline(
              this.processOneFile(
                client,
                workspaceRoot,
                file,
                openFileCache,
                usedNodeKeysByFile,
              ),
              remainingMs,
            )
          : await this.processOneFile(
              client,
              workspaceRoot,
              file,
              openFileCache,
              usedNodeKeysByFile,
            );
      for (const edge of fileEdges) {
        const key = `${edge.sourceNodeKey}->${edge.targetNodeKey}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push(edge);
      }
      filesProcessed.push(file);
      this.closeAndEvict(client, file, openFileCache);
      return { ok: true };
    } catch (err) {
      if (err instanceof DeadlineExceededError) {
        filesFailed.push({
          file,
          reason: LSP_MESSAGES.batchTimedOut(timeoutMs),
        });
        // The underlying `processOneFile` promise was abandoned, not settled (see
        // `raceAgainstDeadline`'s doc comment) -- it may still be reading/writing
        // `openFileCache` for this file, so touching it here would race. The whole client is
        // about to be torn down by the caller's `shutdownSession` anyway.
        return { ok: false, deadlineExceeded: true };
      }
      filesFailed.push({
        file,
        reason: err instanceof Error ? err.message : String(err),
      });
      this.logger.warn(LSP_MESSAGES.resolutionFailedForFile(file), {
        error: err instanceof Error ? err.message : String(err),
      });
      this.closeAndEvict(client, file, openFileCache);
      return { ok: false, deadlineExceeded: false };
    }
  }

  /** Tells the LSP server we're done with `handle`'s file for now and drops its cached symbols.
   *  Shared by the post-turn `closeAndEvict` call in `processOneFileIntoBatch` and the LRU
   *  eviction path in `openAndGetSymbols` -- both need the same delete-from-cache + `DID_CLOSE`
   *  notify, just triggered by a different event (a file's own queue turn ending vs. the cache
   *  hitting its size cap). */
  private closeOpenFile(
    client: LspJsonRpcClient,
    handle: OpenFileHandle,
    cache: Map<string, OpenFileHandle>,
  ): void {
    cache.delete(handle.relativePath);
    client.notify(LspMethods.DID_CLOSE, {
      textDocument: { uri: handle.uri },
    });
  }

  /** Tells the LSP server we're done with `file` for now and drops its cached symbols, as a
   *  cheap proactive shrink once a file's own queue turn finishes (`openFileCache` is
   *  batch-scoped -- see `processAllFiles`'s doc comment). This is complementary to, not a
   *  substitute for, `openAndGetSymbols`'s own `maxOpenFiles` LRU cap: a file opened
   *  transitively as some other callee's caller (`resolveReferenceEdge`) may already have been
   *  evicted by that cap before its own turn ever comes up in `files` -- this call is then a
   *  no-op, which is fine, since the cap is the real bound and this just keeps the cache smaller
   *  sooner. No-op if `file` was never actually opened (e.g. it failed before
   *  `openAndGetSymbols` ran) or was already evicted. */
  private closeAndEvict(
    client: LspJsonRpcClient,
    file: string,
    openFileCache: Map<string, OpenFileHandle>,
  ): void {
    const handle = openFileCache.get(file);
    if (!handle) return;
    this.closeOpenFile(client, handle, openFileCache);
  }

  /** Post-loop reconciliation for `processAllFiles`: once the batch deadline has tripped, every
   *  file in `files` that never got a `filesProcessed`/`filesFailed` entry (never reached, or
   *  in flight when the deadline hit -- see `processAllFiles`'s own doc comment) is reported
   *  through the same `filesFailed` channel so callers can restage exactly the unreached files. */
  private markUnreachedFilesFailed(
    files: string[],
    filesProcessed: string[],
    filesFailed: EdgeResolutionOutcome["filesFailed"],
    timeoutMs: number,
  ): void {
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

  /** Looks up `file`'s disambiguation state, pre-assigning a key for *every* call-site symbol in
   *  `fileSymbols` (line-sorted) the first time this file is touched, then returns the one for
   *  `name`/`startLine`. Matters because this class discovers a file's symbols on demand (as
   *  callee, in `processOneFile`'s own loop; as caller, wherever `resolveReferenceEdge` first
   *  happens to find a reference landing in it) -- whichever symbol happened to be asked about
   *  *first* would otherwise win the bare key regardless of where it actually sits in the file,
   *  which usually won't match Tier A's own assignment (`persist-ast-graph.ts`'s
   *  `persistFileAndSymbolNodes`, which processes a file's parsed symbols as one coherent pass,
   *  not driven by which caller happens to reference which callee first). Pre-sorting by line
   *  before assigning keys converges Tier B's ordering onto Tier A's own within-list order for
   *  the common collision shape (two same-named functions/methods in one file) -- `extractFunctions`
   *  IS itself a source-order tree walk, so Tier A's `functions[]` is naturally line-sorted too.
   *  Line order between an item that's a *class as a whole* and a function/method sharing its name
   *  still isn't guaranteed to match Tier A's own functions-array-then-classes-array grouping (a
   *  rarer collision shape -- see `node-key.ts`'s doc comment for the still-residual gap this
   *  doesn't close). `startLine`s must already be 0-based (LSP's own `Position.line` is, matching
   *  Tier A's own `startLine` -- see `node-key.ts`).
   *
   *  `containerName` (GRPH-006) is the caller's own enclosing-class read (from
   *  `flattenCallSiteSymbols`/`findDeepestContainingSymbol`); it's only ever folded into the base
   *  key here, behind `this.languageConfig.supportsQualifiedContainment`, so a non-capable
   *  language's containment data -- if it ever leaked through -- can never produce a qualified key
   *  (locked decision: the gate must live here, not upstream). */
  private resolveNodeKeyForFile(
    usedNodeKeysByFile: UsedNodeKeysByFile,
    file: string,
    fileSymbols: LspDocumentSymbol[],
    name: string,
    startLine: number,
    containerName?: string,
  ): string {
    let state = usedNodeKeysByFile.get(file);
    if (!state) {
      state = { used: new Set<string>([file]), resolved: new Map() };
      usedNodeKeysByFile.set(file, state);

      const sorted = [...flattenCallSiteSymbols(fileSymbols)].sort(
        (a, b) =>
          a.symbol.selectionRange.start.line -
          b.symbol.selectionRange.start.line,
      );
      for (const { symbol, containerName: enclosed } of sorted) {
        const identity = `${symbol.name}@${symbol.selectionRange.start.line}`;
        if (state.resolved.has(identity)) continue;
        const nodeKey = buildUniqueNodeKey(
          state.used,
          buildQualifiedBaseKey(
            file,
            symbol.name,
            this.languageConfig.supportsQualifiedContainment
              ? enclosed
              : undefined,
          ),
          symbol.selectionRange.start.line,
        );
        state.used.add(nodeKey);
        state.resolved.set(identity, nodeKey);
      }
    }

    const symbolIdentity = `${name}@${startLine}`;
    const cached = state.resolved.get(symbolIdentity);
    if (cached) return cached;

    // Not found in the pre-pass (e.g. the CLASS_SITE_KINDS filter excluded it, or it's a
    // synthetic lookup) -- fall back to resolving it directly against whatever state exists.
    const nodeKey = buildUniqueNodeKey(
      state.used,
      buildQualifiedBaseKey(
        file,
        name,
        this.languageConfig.supportsQualifiedContainment
          ? containerName
          : undefined,
      ),
      startLine,
    );
    state.used.add(nodeKey);
    state.resolved.set(symbolIdentity, nodeKey);
    return nodeKey;
  }

  private async processOneFile(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    relativePath: string,
    openFileCache: Map<string, OpenFileHandle>,
    usedNodeKeysByFile: UsedNodeKeysByFile,
  ): Promise<ResolvedCallEdge[]> {
    const callee = await this.openAndGetSymbols(
      client,
      workspaceRoot,
      relativePath,
      openFileCache,
    );
    const callSiteSymbols = flattenCallSiteSymbols(callee.symbols);

    // Issue every symbol's `textDocument/references` in one burst before awaiting any of them
    // (issue #11 throughput fix). The client correlates requests by id and resolves each
    // independently, so `Promise.all` keeps the results zipped to `callSiteSymbols`' order while
    // overlapping the per-request round-trips the previous sequential `await` of each one left
    // fully serialized -- the dominant per-file cost at repo scale (vscode's ~24 symbols/file →
    // ~24 sequential round-trips/file). A rejected request still rejects the whole `Promise.all`,
    // so a hung `references` behaves exactly as it did when awaited inline. Edge resolution below
    // stays serial (one reference at a time), so `resolveReferenceEdge`'s shared-state mutations
    // to `openFileCache`/`usedNodeKeysByFile` remain serialized exactly as before.
    const referenceResults = await Promise.all(
      callSiteSymbols.map(({ symbol }) =>
        client.request<{ uri: string; range: LspRange }[]>(
          LspMethods.REFERENCES,
          {
            textDocument: { uri: callee.uri },
            position: symbol.selectionRange.start,
            context: { includeDeclaration: false },
          },
          this.requestTimeoutMs,
        ),
      ),
    );

    const edges: ResolvedCallEdge[] = [];
    for (let i = 0; i < callSiteSymbols.length; i++) {
      const { symbol, containerName } = callSiteSymbols[i];
      const references = referenceResults[i] ?? [];
      const calleeNodeKey = toNodeKey(
        this.resolveNodeKeyForFile(
          usedNodeKeysByFile,
          relativePath,
          callee.symbols,
          symbol.name,
          symbol.selectionRange.start.line,
          containerName,
        ),
      );
      for (const ref of references) {
        const edge = await this.resolveReferenceEdge(
          client,
          workspaceRoot,
          ref,
          calleeNodeKey,
          relativePath,
          openFileCache,
          usedNodeKeysByFile,
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
    usedNodeKeysByFile: UsedNodeKeysByFile,
  ): Promise<ResolvedCallEdge | undefined> {
    const refPath = path.relative(workspaceRoot, fileURLToPath(ref.uri));
    // A reference outside the workspace (e.g. TypeScript's global Automatic Type Acquisition
    // cache under %LOCALAPPDATA%, a vendored @types package, or any file the LSP resolved from
    // outside this project) has no corresponding graph node to attribute an edge to. On Windows,
    // `path.relative()` can't express a path across drive letters (D:\...\repo vs
    // C:\Users\...\AppData\...) and returns the target's own absolute path unchanged instead of
    // a `..`-relative one — silently feeding an absolute path into `openAndGetSymbols`'s
    // `path.join(workspaceRoot, relativePath)` below (via the recursive call this method makes),
    // producing an unopenable `D:\...\repo\C:\Users\...` path and failing the whole file's batch.
    // `startsWith("..")` catches the same-drive case (a reference above workspaceRoot);
    // `isAbsolute` catches the cross-drive one.
    if (path.isAbsolute(refPath) || refPath.startsWith("..")) {
      return undefined;
    }
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
      enclosing && CALL_SITE_KINDS.has(enclosing.symbol.kind)
        ? toNodeKey(
            this.resolveNodeKeyForFile(
              usedNodeKeysByFile,
              refRelative,
              caller.symbols,
              enclosing.symbol.name,
              enclosing.symbol.selectionRange.start.line,
              enclosing.containerName,
            ),
          )
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
    if (cached) {
      // Bump recency: `Map` iteration order is insertion order, so deleting then re-setting the
      // same key moves it to the end -- making the cache's first key always the
      // least-recently-used entry for the eviction loop below.
      cache.delete(relativePath);
      cache.set(relativePath, cached);
      return cached;
    }

    const absolutePath = path.join(workspaceRoot, relativePath);
    const content = await fs.readFile(absolutePath, UTF8_ENCODING);
    const uri = pathToFileURL(absolutePath).toString();

    // Evict the least-recently-used entries (the cache's own first keys, per the recency bump
    // above) until there's room for the file we're about to open -- done *before* opening it, so
    // the LSP server never holds more than `maxOpenFiles` documents open at once, not even
    // transiently. This is the actual bound on simultaneously-open documents, independent of
    // where either file sits in the batch queue (see `DEFAULT_MAX_OPEN_FILES`'s doc comment for
    // why queue-position alone wasn't enough).
    while (cache.size >= this.maxOpenFiles) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldestHandle = cache.get(oldestKey);
      if (oldestHandle) this.closeOpenFile(client, oldestHandle, cache);
    }

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
