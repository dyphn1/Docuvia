import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type {
  EdgeResolutionAvailability,
  EdgeResolutionCallSite,
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

/** Default `EdgeResolutionProviderConfig.processMemoryEstimateMb` -- a conservative estimate of one
 *  shard process's steady-state memory (the LSP server binary + its language server child, e.g.
 *  typescript-language-server forking tsserver). Used to bound effective shard count against the
 *  batch's memory budget (see `maxProcessMemoryMb`). Untuned; a round number chosen so that a
 *  default budget (below) still allows several shards even on a modest machine. */
const DEFAULT_PROCESS_MEMORY_ESTIMATE_MB = 512;
/** Default `EdgeResolutionProviderConfig.maxProcessMemoryMb` (in MiB): the portion of the current
 *  machine's memory a whole batch's shards may occupy at once, when the caller sets no explicit
 *  budget. Defaults to 25% of total system memory (rounded up to at least one shard's worth) so a
 *  single batch can never consume the whole machine regardless of `maxProcesses`, even before
 *  TypeScript's own `--max-old-space-size` heap cap is hit. */
const DEFAULT_PROCESS_MEMORY_BUDGET_RATIO = 0.25;

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
 *  ordinary per-file processing error inside `runOneSlot`'s catch block -- both currently land
 *  in the same `filesFailed` channel, but only the former should also flip the batch-level
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

/** Batch-scoped shared mutable state (Tier B K-way concurrency plan). Every field here is
 *  written from multiple files' processing turns and must only ever be mutated inside a
 *  synchronous critical section (no `await` between reading and writing) -- see the plan's
 *  Finding E. Constructed once per `processAllFiles` call, discarded at the end of the batch. */
interface SharedBatchState {
  openFileCache: Map<string, OpenFileHandle>;
  /** In-flight `openAndGetSymbols` calls, keyed by relativePath -- request-coalescing so two
   *  concurrent turns wanting the same not-yet-cached file await the same open instead of each
   *  issuing their own `DID_OPEN`/`documentSymbol` (a stampede; also an LSP protocol violation
   *  -- see Phase 3). Empty outside of Phase 3+. */
  inFlightOpens: Map<string, Promise<OpenFileHandle>>;
  /** relativePaths currently "owned" by an in-flight worker turn as that turn's own file (see
   *  D7) -- eviction in `openAndGetSymbols` must never pick a pinned path. Empty outside of
   *  Phase 4+. */
  pinnedPaths: Set<string>;
  usedNodeKeysByFile: UsedNodeKeysByFile;
}

/** One file's outcome from `runOneSlot`, written into `processAllFiles`'s index-ordered `slots`
 *  array (D2) instead of being pushed onto shared accumulators directly -- keeps every worker's
 *  writes confined to its own slot, so the post-loop flatten pass is the only place that mutates
 *  the batch-level `edges`/`filesProcessed`/`filesFailed` arrays. */
type RunOneSlotResult =
  | { ok: true; edges: ResolvedCallEdge[] }
  | { ok: false; deadlineExceeded: boolean; reason: string };

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
  /** FWD-004 (issue #11 plan A): per-language authoritative switch for Tier B's forward
   *  resolution pass. "forward" only after that language's own calibration slice (fixture +
   *  real-repo spot check) proves textDocument/definition resolves its known call chains
   *  correctly -- this is the single flag Slice 4 flips per language; it is independent of
   *  whether callsByFile happens to carry data for a file (Tier A's ast_call_sites persistence
   *  is language-agnostic, so data existing is not by itself safe-to-use -- see Slice 3's plan,
   *  Finding A). Every provider must set this explicitly (no default) so a newly-added language
   *  can't silently inherit "forward" by omission. */
  definitionResolution: "forward" | "reverse";
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

  /** See `EdgeResolutionProviderConfig.maxConcurrentFiles` (Tier B K-way concurrency plan). `1`
   *  reproduces today's strictly-serial `processAllFiles` behavior exactly. */
  private get maxConcurrentFiles(): number {
    return this.config.maxConcurrentFiles ?? 1;
  }

  /** See `EdgeResolutionProviderConfig.maxProcesses` (Tier B multi-process sharding plan). `1`
   *  reproduces today's single-spawn-per-batch behavior exactly. */
  private get maxProcesses(): number {
    return this.config.maxProcesses ?? 1;
  }

  /** Per-shard steady-state memory estimate (MiB) used to bound `maxProcesses` against memory. */
  private processMemoryEstimateMb(): number {
    return (
      this.config.processMemoryEstimateMb ?? DEFAULT_PROCESS_MEMORY_ESTIMATE_MB
    );
  }

  /** The batch's total memory budget (MiB) for all shard processes at once. When the caller sets
   *  an explicit `maxProcessMemoryMb`, it wins; otherwise the provider derives a bound from the
   *  current machine's total memory (`DEFAULT_PROCESS_MEMORY_BUDGET_RATIO`) so an unscoped
   *  `maxProcesses` can never consume the whole machine. */
  private maxProcessMemoryMb(): number {
    if (this.config.maxProcessMemoryMb !== undefined) {
      return this.config.maxProcessMemoryMb;
    }
    return Math.max(
      Math.round(
        (os.totalmem() / 1024 / 1024) * DEFAULT_PROCESS_MEMORY_BUDGET_RATIO,
      ),
      this.processMemoryEstimateMb(),
    );
  }

  /** Clamps the configured file-concurrency to something the batch can safely run: never more
   *  than there are files to process, and never so high that K in-flight turns' own pinned files
   *  (D7) alone could approach `maxOpenFiles` and starve the LRU cache for every target open (D4).
   *  Logs once per batch when clamping actually changes the requested value. */
  private effectiveConcurrency(fileCount: number): number {
    const requested = this.maxConcurrentFiles;
    const clamped = Math.max(
      1,
      Math.min(requested, fileCount, this.maxOpenFiles - 1),
    );
    if (clamped !== requested) {
      this.logger.debug(LSP_MESSAGES.concurrencyClamped(requested, clamped));
    }
    return clamped;
  }

  /** Clamps the configured process-shard count to what the batch can safely have at once: never
   *  more than there are files to process, and never zero (an empty `files` batch short-circuits
   *  before this is reached). `maxProcesses` is a *per-core/client* knob, so it is not bound by
   *  `maxOpenFiles` the way `effectiveConcurrency` is -- but memory scales with process count
   *  (each server holds its own process program), so the count is additionally bounded by the
   *  batch's memory budget (`maxProcessMemoryMb / processMemoryEstimateMb`) -- the fix for the
   *  multi-process-sharding memory crash. Logs once per batch when clamping actually changes the
   *  requested value. */
  private effectiveProcesses(fileCount: number): number {
    const requested = this.maxProcesses;
    const memoryBounded = Math.floor(
      this.maxProcessMemoryMb() / this.processMemoryEstimateMb(),
    );
    const clamped = Math.max(1, Math.min(requested, fileCount, memoryBounded));
    if (clamped !== requested) {
      this.logger.debug(LSP_MESSAGES.processShardsClamped(requested, clamped));
      if (
        clamped < requested &&
        memoryBounded < Math.min(requested, fileCount)
      ) {
        this.logger.debug(
          LSP_MESSAGES.processShardsMemoryClamped(
            requested,
            clamped,
            this.maxProcessMemoryMb(),
            this.processMemoryEstimateMb(),
          ),
        );
      }
    }
    return clamped;
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
    const processCount = this.effectiveProcesses(request.files.length);
    if (processCount <= 1) {
      const client = this.createClient();
      return this.runBatch(client, request, timeoutMs);
    }

    // Tier B multi-process sharding plan: split the batch across `processCount` independent LSP
    // server processes (each its own `LspJsonRpcClient`). Unlike `maxConcurrentFiles` (which
    // only overlaps IPC round-trips over ONE server's serial compute -- the K=4 ~12% ceiling),
    // sharding gives each server its own process/program so per-request *compute* actually
    // parallelizes across cores. `edge set parity` is preserved by construction: each file is in
    // exactly one shard, and node_keys/file outcomes are per-file deterministic, so merging the
    // shards' outcomes (files-augmented merge) reproduces a single-process batch exactly.
    const shards = this.partitionRequest(request, processCount);
    const outcomes = await Promise.all(
      shards.map((shard) => {
        const client = this.createClient();
        return this.runBatch(client, shard, timeoutMs);
      }),
    );
    return this.mergeShardOutcomes(outcomes, request.files);
  }
  private languageIdFor(filePath: string): string {
    return (
      this.languageConfig.languageIdByExtension[path.extname(filePath)] ??
      this.languageConfig.defaultLanguageId
    );
  }

  /** Splits a request across `processCount` shards for the multi-process sharding driver — a
   *  contiguous, round-robin-ish partition of `request.files`, with `callsByFile` (the AST
   *  call-site seeds, forward path only) kept per-file so each shard only carries the seeds for
   *  the files IT owns. Each file lands in exactly one shard; outer order is preserved per shard
   *  (shard i = files[i], files[i+P], ...). */
  private partitionRequest(
    request: EdgeResolutionRequest,
    processCount: number,
  ): EdgeResolutionRequest[] {
    const shards: EdgeResolutionRequest[] = Array.from(
      { length: processCount },
      () => ({
        workspaceRoot: request.workspaceRoot,
        files: [],
        callsByFile: {},
      }),
    );
    for (let i = 0; i < request.files.length; i++) {
      const file = request.files[i];
      const shard = shards[i % processCount];
      shard.files.push(file);
      const seeds = request.callsByFile?.[file];
      if (seeds) shard.callsByFile![file] = seeds;
    }
    return shards;
  }

  /** Merges per-shard `EdgeResolutionOutcome`s back into one batch-level outcome for the
   *  multi-process sharding driver. Edge sets are unioned across shards; `filesProcessed` /
   *  `filesFailed` are re-ordered to the original `request.files` order (each file is owned by
   *  exactly one shard, so a shard-completion-order union would otherwise be non-deterministic
   *  across runs -- byte-identical output to a single-process batch is the keystone invariant).
   *  `unavailableReason` is dropped unless EVERY shard failed to run, in which case the shards
   *  are guaranteed to have the same root cause and the first is kept. A shard that resolved the
   *  whole batch fine never contributes `unavailableReason`, so a single shard that hit a
   *  per-shard timeout degrades only that shard's files via `filesFailed`, not the whole batch. */
  private mergeShardOutcomes(
    outcomes: EdgeResolutionOutcome[],
    files: string[],
  ): EdgeResolutionOutcome {
    const edges: ResolvedCallEdge[] = [];
    const filesProcessedSet = new Set<string>();
    const filesFailedByFile = new Map<string, string>();
    let unavailableReasons = 0;

    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      edges.push(...outcome.edges);
      for (const file of outcome.filesProcessed) filesProcessedSet.add(file);
      for (const failure of outcome.filesFailed)
        filesFailedByFile.set(failure.file, failure.reason);
      if (outcome.unavailableReason) unavailableReasons++;
    }

    edges.sort((a, b) =>
      (a.sourceNodeKey + "->" + a.targetNodeKey).localeCompare(
        b.sourceNodeKey + "->" + b.targetNodeKey,
      ),
    );

    const { filesProcessed, filesFailed } = this.reorderFiles(
      files,
      filesProcessedSet,
      filesFailedByFile,
    );

    const merged: EdgeResolutionOutcome = {
      edges,
      filesProcessed,
      filesFailed,
    };
    if (unavailableReasons === outcomes.length && outcomes.length > 0)
      merged.unavailableReason = outcomes.find(
        (o) => o.unavailableReason,
      )?.unavailableReason;
    return merged;
  }

  /** Rolls per-shard `filesProcessed`/`filesFailed` back into the original `request.files` order
   *  so sharding's completion order can't leak into the merged outcome (determinism / byte-parity
   *  with single-process). A file is either processed, failed, or neither (an unreached file --
   *  excluded from the merged outcome, matching `markUnreachedFilesFailed`'s caller-side restaging
   *  semantics). */
  private reorderFiles(
    files: string[],
    filesProcessedSet: Set<string>,
    filesFailedByFile: Map<string, string>,
  ): {
    filesProcessed: string[];
    filesFailed: EdgeResolutionOutcome["filesFailed"];
  } {
    const filesProcessed: string[] = [];
    const filesFailed: EdgeResolutionOutcome["filesFailed"] = [];
    for (const file of files) {
      if (filesProcessedSet.has(file)) filesProcessed.push(file);
      else if (filesFailedByFile.has(file))
        filesFailed.push({ file, reason: filesFailedByFile.get(file)! });
    }
    return { filesProcessed, filesFailed };
  }

  private async runBatch(
    client: LspJsonRpcClient,
    request: EdgeResolutionRequest,
    timeoutMs: number,
  ): Promise<EdgeResolutionOutcome> {
    const { workspaceRoot, files, callsByFile } = request;
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
        callsByFile,
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
    callsByFile: EdgeResolutionRequest["callsByFile"],
    deadlineAt: number | undefined,
    timeoutMs: number,
  ): Promise<EdgeResolutionOutcome> {
    // Batch-scoped (not per-`processOneFile`-call): a symbol's file can be touched both as a
    // callee (this loop) and as some other callee's caller file (`resolveReferenceEdge`), so
    // disambiguation state for a given file must stay consistent across both paths, not reset
    // per call -- see `resolveNodeKeyForFile`.
    const state: SharedBatchState = {
      openFileCache: new Map(),
      inFlightOpens: new Map(),
      pinnedPaths: new Set(),
      usedNodeKeysByFile: new Map(),
    };

    const slots: (RunOneSlotResult | undefined)[] = new Array(files.length);

    let cursor = 0;
    let deadlineExceeded = false;

    // Tier B K-way concurrency plan (D1): a bounded worker pool over a shared monotonic index
    // cursor -- each worker's synchronous claim (`cursor++`, no `await` between the deadline
    // check and the claim) is race-free per the plan's Finding E, requires no dependency, and
    // preserves `files`' claim order even though completion order is unconstrained. At the
    // default `maxConcurrentFiles: 1` (`effectiveConcurrency` below), exactly one worker ever
    // runs, so claim order == completion order == today's strictly-serial order.
    const worker = async (): Promise<void> => {
      for (;;) {
        if (deadlineExceeded) return;
        const remainingMs =
          deadlineAt !== undefined ? deadlineAt - Date.now() : undefined;
        if (remainingMs !== undefined && remainingMs <= 0) {
          deadlineExceeded = true;
          return;
        }
        // Synchronous claim -- no `await` between the checks above and this line, so no two
        // workers can ever read/claim the same `cursor` value.
        const index = cursor++;
        if (index >= files.length) return;
        const file = files[index];

        state.pinnedPaths.add(file); // D7 -- protect this worker's own file from eviction
        try {
          const slot = await this.runOneSlot(
            client,
            workspaceRoot,
            file,
            callsByFile,
            state,
            remainingMs,
            timeoutMs,
          );
          slots[index] = slot;
          if (!slot.ok && slot.deadlineExceeded) {
            deadlineExceeded = true;
          }
        } finally {
          state.pinnedPaths.delete(file); // D7
        }
      }
    };

    const k = this.effectiveConcurrency(files.length);
    // D9: wait for every worker to fully exit before reconciling -- each in-flight file races its
    // own deadline independently, so a naive "stop as soon as one flag flips" would read `slots`
    // before every worker has written its own outcome.
    await Promise.allSettled(Array.from({ length: k }, () => worker()));

    // D2: output order is always `files`-input-order -- a single synchronous post-pass flattens
    // `slots` in index order into the final accumulators, regardless of completion order.
    const edges: ResolvedCallEdge[] = [];
    const edgeKeys = new Set<string>();
    const filesProcessed: string[] = [];
    const filesFailed: EdgeResolutionOutcome["filesFailed"] = [];
    for (let i = 0; i < files.length; i++) {
      const slot = slots[i];
      if (!slot) continue; // never claimed -- folded into markUnreachedFilesFailed below
      if (slot.ok) {
        filesProcessed.push(files[i]);
        for (const edge of slot.edges) {
          const key = `${edge.sourceNodeKey}->${edge.targetNodeKey}`;
          if (edgeKeys.has(key)) continue;
          edgeKeys.add(key);
          edges.push(edge);
        }
      } else {
        filesFailed.push({ file: files[i], reason: slot.reason });
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

  /** One file's own turn in `processAllFiles`'s worker pool (Tier B K-way concurrency plan,
   *  renamed/reshaped from `processOneFileIntoBatch`) -- the race-against-deadline/no-race
   *  ternary, the catch's deadline-vs-ordinary-failure split, and the edge dedup loop all still
   *  behave exactly as before; the only change is that this now *returns* a `RunOneSlotResult`
   *  (D2) instead of pushing onto shared `edges`/`filesProcessed`/`filesFailed` accumulators in
   *  place, since concurrent workers can no longer safely share those arrays mid-batch -- the
   *  caller writes the result into its own index-ordered slot. */
  private async runOneSlot(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    file: string,
    callsByFile: EdgeResolutionRequest["callsByFile"],
    state: SharedBatchState,
    remainingMs: number | undefined,
    timeoutMs: number,
  ): Promise<RunOneSlotResult> {
    try {
      const fileEdges =
        remainingMs !== undefined
          ? await this.raceAgainstDeadline(
              this.processOneFile(
                client,
                workspaceRoot,
                file,
                callsByFile,
                state,
              ),
              remainingMs,
            )
          : await this.processOneFile(
              client,
              workspaceRoot,
              file,
              callsByFile,
              state,
            );
      this.closeAndEvict(client, file, state);
      return { ok: true, edges: fileEdges };
    } catch (err) {
      if (err instanceof DeadlineExceededError) {
        // The underlying `processOneFile` promise was abandoned, not settled (see
        // `raceAgainstDeadline`'s doc comment) -- it may still be reading/writing
        // `openFileCache` for this file, so touching it here would race. The whole client is
        // about to be torn down by the caller's `shutdownSession` anyway. Deliberately no
        // `closeAndEvict` call on this path, matching today's behavior.
        return {
          ok: false,
          deadlineExceeded: true,
          reason: LSP_MESSAGES.batchTimedOut(timeoutMs),
        };
      }
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(LSP_MESSAGES.resolutionFailedForFile(file), {
        error: reason,
      });
      this.closeAndEvict(client, file, state);
      return { ok: false, deadlineExceeded: false, reason };
    }
  }

  /** Tells the LSP server we're done with `handle`'s file for now and drops its cached symbols.
   *  Shared by the post-turn `closeAndEvict` call in `runOneSlot` and the LRU eviction path in
   *  `doOpenAndGetSymbols` -- both need the same delete-from-cache + `DID_CLOSE` notify, just
   *  triggered by a different event (a file's own queue turn ending vs. the cache hitting its
   *  size cap). */
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
    state: SharedBatchState,
  ): void {
    const handle = state.openFileCache.get(file);
    if (!handle) return;
    this.closeOpenFile(client, handle, state.openFileCache);
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

  /** CONCURRENCY INVARIANT (Tier B K-way concurrency plan, D8): this function must never contain
   *  an `await`. Its lazy first-touch initialization (the `if (!fileState) { ... }` block below)
   *  is only race-free under K-way concurrency because it runs synchronously to completion once
   *  called -- adding an `await` anywhere in this function would split that critical section
   *  across an event-loop turn and reopen exactly the "two workers both initialize the same
   *  file's state" race this class is otherwise free of. If this function ever needs to await
   *  something, revisit this plan's Finding E and add real synchronization (a per-file async
   *  mutex keyed by `state.usedNodeKeysByFile`'s own key), do not assume the existing shape is
   *  still safe.
   *
   *  Looks up `file`'s disambiguation state, pre-assigning a key for *every* call-site symbol in
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
    state: SharedBatchState,
    file: string,
    fileSymbols: LspDocumentSymbol[],
    name: string,
    startLine: number,
    containerName?: string,
  ): string {
    let fileState = state.usedNodeKeysByFile.get(file);
    if (!fileState) {
      fileState = { used: new Set<string>([file]), resolved: new Map() };
      state.usedNodeKeysByFile.set(file, fileState);

      const sorted = [...flattenCallSiteSymbols(fileSymbols)].sort(
        (a, b) =>
          a.symbol.selectionRange.start.line -
          b.symbol.selectionRange.start.line,
      );
      for (const { symbol, containerName: enclosed } of sorted) {
        const identity = `${symbol.name}@${symbol.selectionRange.start.line}`;
        if (fileState.resolved.has(identity)) continue;
        const nodeKey = buildUniqueNodeKey(
          fileState.used,
          buildQualifiedBaseKey(
            file,
            symbol.name,
            this.languageConfig.supportsQualifiedContainment
              ? enclosed
              : undefined,
          ),
          symbol.selectionRange.start.line,
        );
        fileState.used.add(nodeKey);
        fileState.resolved.set(identity, nodeKey);
      }
    }

    const symbolIdentity = `${name}@${startLine}`;
    const cached = fileState.resolved.get(symbolIdentity);
    if (cached) return cached;

    // Not found in the pre-pass (e.g. the CLASS_SITE_KINDS filter excluded it, or it's a
    // synthetic lookup) -- fall back to resolving it directly against whatever state exists.
    const nodeKey = buildUniqueNodeKey(
      fileState.used,
      buildQualifiedBaseKey(
        file,
        name,
        this.languageConfig.supportsQualifiedContainment
          ? containerName
          : undefined,
      ),
      startLine,
    );
    fileState.used.add(nodeKey);
    fileState.resolved.set(symbolIdentity, nodeKey);
    return nodeKey;
  }

  private async processOneFile(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    relativePath: string,
    callsByFile: EdgeResolutionRequest["callsByFile"],
    state: SharedBatchState,
  ): Promise<ResolvedCallEdge[]> {
    const callSites = callsByFile?.[relativePath];
    // Forward only when this language's own config has been explicitly flipped to "forward"
    // (FWD-004/D2) AND Tier A seeded this file's call sites (FWD-01/002) -- the provider config
    // is the single authoritative safety gate, independent of whether callsByFile happens to
    // carry data (Tier A's ast_call_sites persistence is language-agnostic, so data existing
    // alone is not safe-to-use — issue #11 plan A Slice 3, Finding A). The reverse pipeline
    // stays the default/fallback until a language's calibration slice proves `definition`
    // resolves its known call chains (FWD-04).
    if (
      this.languageConfig.definitionResolution === "forward" &&
      callSites &&
      callSites.length > 0
    ) {
      return this.processOneFileForward(
        client,
        workspaceRoot,
        relativePath,
        callSites,
        state,
      );
    }
    return this.processOneFileReverse(
      client,
      workspaceRoot,
      relativePath,
      state,
    );
  }

  private async processOneFileReverse(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    relativePath: string,
    state: SharedBatchState,
  ): Promise<ResolvedCallEdge[]> {
    const callee = await this.openAndGetSymbols(
      client,
      workspaceRoot,
      relativePath,
      state,
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
          state,
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
          state,
        );
        if (edge) edges.push(edge);
      }
    }
    return edges;
  }

  /**
   * Forward Tier B pass for one file (FWD-01/002): this file is a *caller*, seeded with Tier A AST
   * call-site positions (`callsByFile`). Each call site's callee is resolved directly with
   * `textDocument/definition` — module resolution + symbol locate, not a project-wide reverse scan —
   * so a hub callee's many callers never each trigger an on-the-fly caller open (issue #11's
   * amplification). The caller file is already open here; each distinct target file is opened once
   * via the shared batch `openFileCache` (it is usually itself a queue file, so it is already
   * cached). Edge shape/node_keys are identical to the reverse path (FWD-03): source = the enclosing
   * call-site symbol of the call position; target = the enclosing symbol of the definition's
   * resolved position.
   */
  private async processOneFileForward(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    relativePath: string,
    callSites: EdgeResolutionCallSite[],
    state: SharedBatchState,
  ): Promise<ResolvedCallEdge[]> {
    const caller = await this.openAndGetSymbols(
      client,
      workspaceRoot,
      relativePath,
      state,
    );
    const edges: ResolvedCallEdge[] = [];

    // Issue every call site's `definition` in one pipelined burst — the same ordering-preserving
    // `Promise.all` as the reverse pass (issue #11 fix), so per-call-site module-resolution
    // round-trips overlap instead of serializing. The client correlates by id, so each result stays
    // zipped to its call site.
    const definitions = await Promise.all(
      callSites.map(({ startLine, startColumn }) =>
        client.request<
          | { uri: string; range: LspRange }[]
          | { uri: string; range: LspRange }
          | null
        >(
          LspMethods.DEFINITION,
          {
            textDocument: { uri: caller.uri },
            position: { line: startLine, character: startColumn },
          },
          this.requestTimeoutMs,
        ),
      ),
    );

    for (let i = 0; i < callSites.length; i++) {
      const { startLine, startColumn } = callSites[i];
      const targetNodeKey = await this.resolveFirstDefinitionTarget(
        client,
        workspaceRoot,
        relativePath,
        definitions[i],
        state,
      );
      if (targetNodeKey === undefined) continue;

      const source = findDeepestContainingSymbol(caller.symbols, {
        line: startLine,
        character: startColumn,
      });
      const sourceNodeKey =
        source && CALL_SITE_KINDS.has(source.symbol.kind)
          ? toNodeKey(
              this.resolveNodeKeyForFile(
                state,
                relativePath,
                caller.symbols,
                source.symbol.name,
                source.symbol.selectionRange.start.line,
                source.containerName,
              ),
            )
          : relativePath;

      if (sourceNodeKey !== targetNodeKey) {
        edges.push({
          sourceNodeKey,
          targetNodeKey,
          source: EdgeResolutionSources.LSP,
        });
      }
    }
    return edges;
  }

  /** Normalizes a `textDocument/definition` answer (null, a single Location, or a Location[] — e.g.
   *  overloads / multi-module results) down to the first target attributable to an in-workspace edge
   *  (slice-2 spec: "first in-workspace wins, logged"). Candidates that `resolveTargetNodeKey`
   *  declines (out-of-workspace, same-file, or unresolvable) are skipped; if the call site's first
   *  result is rejected and a later one is used, the jump is logged at debug so the pick is
   *  observable. Returns `undefined` when no candidate yields an edge (IMPT-002: never invent one). */
  private async resolveFirstDefinitionTarget(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    sourceRelative: string,
    result:
      | { uri: string; range: LspRange }[]
      | { uri: string; range: LspRange }
      | null,
    state: SharedBatchState,
  ): Promise<string | undefined> {
    if (!result) return undefined;
    const locations = Array.isArray(result) ? result : [result];
    for (let i = 0; i < locations.length; i++) {
      const targetNodeKey = await this.resolveTargetNodeKey(
        client,
        workspaceRoot,
        sourceRelative,
        locations[i],
        state,
      );
      if (targetNodeKey !== undefined) {
        if (i > 0) {
          this.logger.debug(
            LSP_MESSAGES.skippedMultiLocationDefinition(sourceRelative),
          );
        }
        return targetNodeKey;
      }
    }
    return undefined;
  }

  /** Resolves a `textDocument/definition` result location to the callee's workspace node_key, or
   *  `undefined` when the target can't be attributed an edge honestly (IMPT-002). Mirrors
   *  `resolveReferenceEdge`'s guards exactly: a definition outside the workspace (TypeScript's
   *  %LOCALAPPDATA% ATA cache, a vendored @types dir, or — on Windows — a cross-drive location where
   *  `path.relative` returns the target's own absolute path) has no graph node to key; a
   *  same-file definition is already covered by Tier A's own AST `calls` edges and is dropped. The
   *  target symbol is the enclosing call-site-kind symbol at the definition position
   *  (GRPH-006 containment via `findDeepestContainingSymbol`); a definition landing outside any
   *  call-site symbol falls back to the file-level key, exactly as the reverse pass does for a
   *  caller whose reference sits outside a call-site symbol. */
  private async resolveTargetNodeKey(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    sourceRelative: string,
    location: { uri: string; range: LspRange },
    state: SharedBatchState,
  ): Promise<string | undefined> {
    const targetPath = path.relative(
      workspaceRoot,
      fileURLToPath(location.uri),
    );
    if (path.isAbsolute(targetPath) || targetPath.startsWith("..")) {
      return undefined;
    }
    const targetRelative = toNodeKey(targetPath);
    if (targetRelative === sourceRelative) return undefined;

    const targetFile = await this.openAndGetSymbols(
      client,
      workspaceRoot,
      targetRelative,
      state,
    );
    const enclosing = findDeepestContainingSymbol(
      targetFile.symbols,
      location.range.start,
    );
    return enclosing && CALL_SITE_KINDS.has(enclosing.symbol.kind)
      ? toNodeKey(
          this.resolveNodeKeyForFile(
            state,
            targetRelative,
            targetFile.symbols,
            enclosing.symbol.name,
            enclosing.symbol.selectionRange.start.line,
            enclosing.containerName,
          ),
        )
      : targetRelative;
  }

  private async resolveReferenceEdge(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    ref: { uri: string; range: LspRange },
    calleeNodeKey: string,
    calleeFile: string,
    state: SharedBatchState,
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
      state,
    );
    const enclosing = findDeepestContainingSymbol(
      caller.symbols,
      ref.range.start,
    );
    const sourceNodeKey =
      enclosing && CALL_SITE_KINDS.has(enclosing.symbol.kind)
        ? toNodeKey(
            this.resolveNodeKeyForFile(
              state,
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
    state: SharedBatchState,
  ): Promise<OpenFileHandle> {
    // Synchronous critical section (D5/Finding E) -- cache check, in-flight check, and in-flight
    // registration must complete with zero `await`s between them, or two concurrent callers can
    // both decide "not cached, not in flight" for the same path and each issue their own
    // DID_OPEN/documentSymbol (a stampede -- also an LSP protocol violation: didOpen twice for one
    // URI without an intervening didClose).
    const cache = state.openFileCache;
    const cached = cache.get(relativePath);
    if (cached) {
      // Bump recency: `Map` iteration order is insertion order, so deleting then re-setting the
      // same key moves it to the end -- making the cache's first key always the
      // least-recently-used entry for the eviction loop below.
      cache.delete(relativePath);
      cache.set(relativePath, cached);
      return cached;
    }
    const inFlight = state.inFlightOpens.get(relativePath);
    if (inFlight) return inFlight;

    const openPromise = this.doOpenAndGetSymbols(
      client,
      workspaceRoot,
      relativePath,
      state,
    ).finally(() => state.inFlightOpens.delete(relativePath));
    state.inFlightOpens.set(relativePath, openPromise); // registration, still synchronous
    return openPromise;
  }

  /** Selects the least-recently-used *unpinned* entry to evict (D7) -- `Map` iteration order is
   *  insertion order, and `openAndGetSymbols`'s recency bump (delete+re-set on cache hit) keeps
   *  the least-recently-used entry first, exactly as today's single-threaded LRU relied on.
   *  Skips any path in `state.pinnedPaths` -- a file currently owned by another in-flight
   *  worker's own turn (see D7's rationale: only the *own*-file case needs protection, since every
   *  other opened file's `.symbols` are read synchronously into a local variable once and never
   *  referenced again by URI). Returns `undefined` when every cached entry is pinned -- the caller
   *  (`doOpenAndGetSymbols`'s while-loop) then breaks and accepts bounded overshoot (at most `K-1`
   *  documents over `maxOpenFiles`, since at most `K` files can ever be pinned at once) rather
   *  than spin forever waiting for a pin that won't release until some other worker's turn ends.
   *  This also closes a pre-existing latent bug at K=1: a file with more distinct call-site
   *  targets than `maxOpenFiles` could already, today, evict its own just-opened self if
   *  `relativePath` happened to be the oldest entry at the moment of its own re-lookup -- pinning
   *  closes this for good, at every K including `1`. */
  private pickEvictionVictim(
    state: SharedBatchState,
  ): OpenFileHandle | undefined {
    for (const [key, handle] of state.openFileCache) {
      if (!state.pinnedPaths.has(key)) return handle;
    }
    return undefined;
  }

  private async doOpenAndGetSymbols(
    client: LspJsonRpcClient,
    workspaceRoot: string,
    relativePath: string,
    state: SharedBatchState,
  ): Promise<OpenFileHandle> {
    // D6: count in-flight opens against the cap, not just settled cache entries -- otherwise K
    // concurrent opens can each independently see room under `maxOpenFiles` and the server
    // transiently holds more than `maxOpenFiles` documents open at once. NOTE: this call's own
    // slot is deliberately NOT yet in `state.inFlightOpens` while this loop runs --
    // `openAndGetSymbols` evaluates this whole function body synchronously up to the first
    // `await` below *before* it registers the returned promise in `inFlightOpens` -- so `>=`
    // (evict until the total, once this call's own about-to-be-registered slot is added, is at
    // most `maxOpenFiles`) is correct here, not `>`.
    while (
      state.openFileCache.size + state.inFlightOpens.size >=
      this.maxOpenFiles
    ) {
      const victim = this.pickEvictionVictim(state);
      if (!victim) break; // every open entry is pinned (Phase 4+); accept bounded overshoot
      this.closeOpenFile(client, victim, state.openFileCache);
    }

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
    state.openFileCache.set(relativePath, handle);
    return handle;
  }
}
