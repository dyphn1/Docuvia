/**
 * D1 edge-resolution provider seam (phase1-decision-integration.md §8b; PLAT-007 Tier B) —
 * `escalateToLsp`'s real implementation sits behind this interface so a second provider (§8b
 * Provider 2: small-model/LLM compensation, Slice 4+) can be added later without touching the
 * Tier B batch orchestrator. Provider 1 (this slice): spawn-per-batch headless
 * `typescript-language-server`, resolved project-locally, never bundled with docuvia itself.
 *
 * Parallel semantics when more than one provider is enabled (not yet true in this slice, since
 * only Provider 1 exists): providers run in parallel and results merge by provenance — `lsp`
 * edges are authoritative, `llm-inferred` edges must carry a `confidence`, and LSP wins conflicts
 * on the same (sourceNodeKey, targetNodeKey) pair.
 */
export const EdgeResolutionSources = {
  LSP: "lsp",
  LLM_INFERRED: "llm-inferred",
} as const;
export type EdgeResolutionSource =
  (typeof EdgeResolutionSources)[keyof typeof EdgeResolutionSources];

/**
 * A single corrected cross-file `calls` edge, keyed by STOR-005 `node_key` — never a raw
 * `l2_nodes.id` — so the Tier B batch can resolve it against whichever ids are current at insert
 * time (phase1-decision-integration.md §8d's node_key re-attach strategy). The caller (Tier B
 * batch) is responsible for resolving both sides via `IGraphNodesRepo.findNodeIdByNodeKey` and
 * dropping the edge — never inventing a node — when either side doesn't resolve.
 */
export interface ResolvedCallEdge {
  sourceNodeKey: string;
  targetNodeKey: string;
  source: EdgeResolutionSource;
  /** Required when `source` is `llm-inferred` (§8b); absent/ignored for `lsp` edges, which are
   *  authoritative by construction. */
  confidence?: number;
}

/** Result of a provider's pre-flight readiness check (phase1-decision-integration.md §8c's
 *  environment gate + §8b's honest-degradation reason). */
export interface EdgeResolutionAvailability {
  available: boolean;
  /** Human-readable reason when `available` is `false` — surfaced in JSONL logs and (Slice 5)
   *  `doctor`. Always present when `available` is `false`. */
  reason?: string;
}

export interface EdgeResolutionFileFailure {
  file: string;
  reason: string;
}

/**
 * Outcome of a `resolveEdges()` call. `unavailableReason` set means the provider could not run at
 * all (binary unresolvable, spawn/initialize failure, whole-batch timeout) — `edges` is then
 * always `[]` and every requested file effectively stayed at AST precision (honest degradation,
 * §8b: "AST-level edges stay as they are"). When `unavailableReason` is unset, the provider ran;
 * `filesProcessed` succeeded, `filesFailed` failed individually (§8g: kept in the Tier B queue for
 * the next batch) while the rest of the batch still proceeded.
 */
export interface EdgeResolutionOutcome {
  edges: ResolvedCallEdge[];
  filesProcessed: string[];
  filesFailed: EdgeResolutionFileFailure[];
  unavailableReason?: string;
}

/**
 * One Tier A AST call-site seed handed to the provider's forward pass (FWD-002). The resolver only
 * needs the call's *position* to issue `textDocument/definition` against the caller file; the callee
 * token text (`targetFunction`) is carried for logging/calibration but is never itself used to
 * resolve the target (that is LSP's job). The source symbol is *derived*, not carried, via
 * `findDeepestContainingSymbol` at the call position — the same containment gate the reverse pass
 * uses. Line/column are 0-based, matching both `LspPosition.line`/`character` and Tier A's
 * `node.startPosition`/`startColumn` seed (Slice 1).
 */
export interface EdgeResolutionCallSite {
  targetFunction: string;
  startLine: number;
  startColumn: number;
}

export interface EdgeResolutionRequest {
  workspaceRoot: string;
  /** Workspace-relative paths, already language-dispatched (§8e) to this provider's supported
   *  language(s) — the provider itself never re-checks language support. */
  files: string[];
  /** Optional per-file Tier A AST call-site seeds that switch the provider onto the *forward*
   *  resolution path for the files they cover (FWD-01/002): each call site's callee is resolved
   *  directly with `textDocument/definition` instead of a project-wide reverse-`references` scan.
   *  Files absent from this map — and files mapped to an empty array — keep the reverse path as
   *  today (FWD-01: reverse stays as the fallback). As of Slice 2 no orchestrator producer wires
   *  this in, so production behavior is unchanged; it is the unit-tested seam the Flip (Slice 3)
   *  feeds call sites through. */
  callsByFile?: Record<string, EdgeResolutionCallSite[]>;
}

/** Construction-time overrides (phase1-decision-integration.md §8b: "config-overridable; never
 *  bundled"). All optional — a provider with no overrides resolves its binary via its own default
 *  strategy (`node_modules/.bin` -> `npx --no-install`, per §8b). */
export interface EdgeResolutionProviderConfig {
  /** Absolute path (or bare command resolvable on PATH) to the LSP server binary. Overrides the
   *  provider's default resolution strategy entirely — used both for real user overrides and for
   *  pointing tests at a fixture server. */
  binaryOverride?: string;
  /** Args passed to `binaryOverride`/the resolved binary (e.g. `["--stdio"]`). */
  argsOverride?: string[];
  /** Whole-batch timeout in milliseconds (spawn through shutdown), and — `BaseLspEdgeProvider`
   *  specifically — the per-request timeout too (same knob, not two independent ones; see
   *  `BaseLspEdgeProvider.requestTimeoutMs`). Generous by default per §8h's "tentative, function
   *  first" ruling. `0` means "never time out": some servers (csharp-ls on a large Roslyn/MSBuild
   *  solution) have no known upper bound on how long a first response can take. */
  timeoutMs?: number;
  /** Hard cap on how many files' documents `BaseLspEdgeProvider` will hold open in the LSP
   *  server at once during a batch (LRU-evicted beyond this). Untuned — a round number chosen to
   *  comfortably cover normal reference fan-out without ever handing a huge multi-project-
   *  reference workspace (e.g. vscode-scale) an unbounded number of simultaneously-open
   *  documents; re-tune if a real workload shows it's off. See `BaseLspEdgeProvider`'s
   *  `openAndGetSymbols` for the eviction mechanics. */
  maxOpenFiles?: number;
  /** Bounded cross-file concurrency for BaseLspEdgeProvider's batch loop (Tier B K-way
   *  concurrency plan): how many files' own processing turns run in flight at once. `1`
   *  (default) reproduces today's strictly-serial behavior exactly -- this field is a pure
   *  throughput knob, never a correctness one (every K must produce identical edges/node_keys;
   *  see BaseLspEdgeProvider's own K-invariance test). Clamped at runtime to
   *  `min(configured, files.length, maxOpenFiles - 1)` -- see BaseLspEdgeProvider's
   *  effectiveConcurrency(). */
  maxConcurrentFiles?: number;
}

export interface IEdgeResolutionProvider {
  readonly name: string;
  /** Mirrors `ILlmClient.initialize()`'s shape — per-run config injected by the Orchestration
   *  layer, never read from `process.env` inside the provider itself. Optional: a provider used
   *  with no overrides may skip this call entirely. */
  configure(config: EdgeResolutionProviderConfig): void;
  /** Environment/pre-flight readiness (§8c's mandatory gate for `init`/manual invocations; also
   *  the first honest-degradation check §8b requires before ever attempting to spawn). Never
   *  throws — a check that itself fails is reported as `available: false`. */
  checkAvailability(workspaceRoot: string): Promise<EdgeResolutionAvailability>;
  /** Resolves cross-file edges over `request.files`. Never throws for an ordinary
   *  unavailable/timeout/per-file-failure outcome (those are reported in the returned
   *  `EdgeResolutionOutcome`, per §8b's honest-degradation rule) — only an unexpected
   *  programming error should reject. */
  resolveEdges(request: EdgeResolutionRequest): Promise<EdgeResolutionOutcome>;
}

/**
 * Tier B's per-language vocabulary (multi-language-lsp-support plan, Finding A) — the registry
 * key type shared by `TOKENS.EdgeResolutionProviders` (`tokens.ts`) and the Tier B dispatch table
 * (`lib/ui-core/src/workflows/analyze/tier-b-language-dispatch.ts`), so both sides speak the same
 * vocabulary. Only `TYPESCRIPT` has a shipped provider as of this slice; the rest are reserved for
 * their own later slices (see the plan's §3 language-by-language table) and are not yet wired to
 * any dispatch entry or registry key.
 */
export const TIER_B_LANGUAGE_IDS = {
  TYPESCRIPT: "typescript",
  PYTHON: "python",
  GO: "go",
  RUST: "rust",
  JAVA: "java",
  CPP: "cpp",
  CSHARP: "csharp",
  PHP: "php",
  RUBY: "ruby",
} as const;
export type TierBLanguageId =
  (typeof TIER_B_LANGUAGE_IDS)[keyof typeof TIER_B_LANGUAGE_IDS];
