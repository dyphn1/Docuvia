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

export interface EdgeResolutionRequest {
  workspaceRoot: string;
  /** Workspace-relative paths, already language-dispatched (§8e) to this provider's supported
   *  language(s) — the provider itself never re-checks language support. */
  files: string[];
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
  /** Whole-batch timeout in milliseconds (spawn through shutdown) — generous by default per §8h's
   *  "tentative, function first" ruling. */
  timeoutMs?: number;
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
