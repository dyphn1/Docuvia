/** Abbreviated sha length used in human-readable notes. */
const SHORT_SHA_LENGTH = 7;

/** Progress/result messages for the `impact` workflow. */
export const IMPACT_MESSAGES = {
  RESOLVING: "Resolving blast radius...",
  DB_NOT_FOUND: 'Local database not found. Please run "docuvia init".',
  /** Issue #136: attached to an empty blast radius when the target's own file uses the
   *  docuviaFactory registry pattern (`docuviaFactory.register`/`resolve`, `TOKENS.*`) -- the
   *  static edge graph does not model these registry-mediated cross-package edges, so "no
   *  dependents" is at best a partial-coverage answer, never a confident LOW. */
  REGISTRY_MEDIATED_COVERAGE_NOTE:
    'This symbol is resolved through the docuviaFactory/TOKENS registry -- the static edge graph does not model registry-mediated dependencies, so a "no dependents" result may be incomplete.',
  /** Issue #192: attached to an empty blast radius whose workspace Tier B coverage is incomplete
   *  -- the graph hasn't looked at every file yet, so "zero dependents" means unknown, not zero. */
  RISK_NOTE_EMPTY_WITH_PARTIAL_COVERAGE: (processed: number, total: number) =>
    `No dependents found, but only ${processed} of ${total} workspace files have been analyzed -- this is UNKNOWN, not confirmed zero. Run "docuvia analyze" for fuller coverage.`,
  /** Issue #393: target-relevant runtime dependency evidence exists. The sample includes raw
   *  source provenance so a user can inspect why the result is lower-bound. Bounded candidates
   *  are possible runtime targets, not confirmed static edges. */
  RISK_NOTE_DYNAMIC_DEPENDENCY: (
    count: number,
    sourceFile: string,
    line: number,
    expression: string,
    reason: string,
  ) =>
    `Observed ${count} target-relevant runtime dependency evidence record(s); e.g. ${sourceFile}:${line} uses import(${expression}) [${reason}]. Dynamic candidates are possible targets, not confirmed runtime edges, so this result is a lower bound.`,
  /** Issue #508 Phase 2 (D1/D5): the persisted #393 runtime-dependency evidence could not be
   *  trusted (corrupt, wrong-shaped, or missing after a hydrate). Same ladder rung as the dynamic
   *  note: without the evidence, no `import()` boundary was checked, so the result is a lower
   *  bound. A forced full re-ingestion rebuilds the evidence from source. */
  RISK_NOTE_DYNAMIC_EVIDENCE_UNAVAILABLE: (reason: string) =>
    `Runtime dependency evidence is unavailable (${reason}) -- dynamic import() boundaries could not be checked, so this result is a lower bound. Run "docuvia analyze --force" to rebuild it.`,
  /** Issue #516: the snapshot did not preserve the #217 rows needed to recover unresolved
   *  callers. This only applies when the call-site fallback would otherwise run. */
  RISK_NOTE_CALL_SITE_FALLBACK_UNAVAILABLE: (reason: string) =>
    `Call-site fallback evidence is unavailable (${reason}) -- the fallback could not check unresolved callers, so this result is a lower bound. Run "docuvia clean" to reset the local graph, then "docuvia init" to rebuild Tier A call-site evidence.`,
  /** Issue #192: attached to an empty blast radius even at full Tier B coverage -- the static
   *  edge graph only models calls/implements/extends, so dynamic-loading patterns produce no
   *  edge no matter how complete ingestion was (AGENTS.md's documented impact blind spots). */
  RISK_NOTE_EMPTY_STATIC_EDGES_ONLY:
    "No static dependents found. The edge graph models calls/extends/implements only -- runtime-variable imports, computed import() specifiers, and child_process spawns are invisible, so absence of edges is not evidence of no dependents.",
  /** Issue #221 P2': attached to an empty blast radius when the target's own file's Tier A
   *  call-site resolution rate is low -- unresolved call sites in that file are exactly the
   *  edges that would have pointed at this target, so "no dependents" is even less trustworthy
   *  than the generic static-edges-only caveat. Fires only at complete Tier B coverage,
   *  non-registry targets, and a statistically meaningful sample
   *  (`DEFAULT_CALL_RESOLUTION_MIN_SAMPLE`). */
  RISK_NOTE_EMPTY_LOW_RESOLUTION: (resolved: number, applicable: number) =>
    `No static dependents found, but only ${resolved} of ${applicable} call sites in this symbol's own file resolved into edges during ingestion -- dependents calling it from here may be missing from the graph. Run "docuvia analyze --escalate-to-lsp --full" to recover them.`,
  /** Issue #508 Phase 3 (D8): the graph was last ingested at a commit other than HEAD (the
   *  HEAD-sha freshness of #193's `status`). Every dependent added, removed or renamed since then is
   *  invisible, so neither an empty nor a non-empty answer is complete -- the first rung of the
   *  epistemic ladder. */
  RISK_NOTE_GRAPH_STALE: (graphSourceSha: string, headSha: string) =>
    `The knowledge graph reflects ${graphSourceSha.slice(0, SHORT_SHA_LENGTH)} but HEAD is ${headSha.slice(0, SHORT_SHA_LENGTH)} -- dependents added, removed or renamed since then are not reflected. Run 'docuvia analyze'.`,
  /** Issue #192: attached to a NON-EMPTY blast radius when workspace Tier B coverage is
   *  incomplete -- a partially-populated graph must never read as a complete answer
   *  (self-verification 2026-08-05's "confidently wrong non-empty result" failure mode). */
  RISK_NOTE_PARTIAL_COVERAGE_NON_EMPTY: (processed: number, total: number) =>
    `Only ${processed} of ${total} workspace files have been analyzed -- this result may be missing dependents from unprocessed files.`,
} as const;

/** Structured-log event names appended to `impact.log` by the `impact` workflow. */
export const IMPACT_EVENTS = {
  START: "impact.start",
  ERROR: "impact.error",
  SUMMARY: "impact.summary",
} as const;
