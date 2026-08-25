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
  /** Issue #192: attached to an empty blast radius even at full Tier B coverage -- the static
   *  edge graph only models calls/implements/extends, so dynamic-loading patterns produce no
   *  edge no matter how complete ingestion was (AGENTS.md's documented impact blind spots). */
  RISK_NOTE_EMPTY_STATIC_EDGES_ONLY:
    "No static dependents found. The edge graph models calls/extends/implements only -- runtime-variable imports, computed import() specifiers, and child_process spawns are invisible, so absence of edges is not evidence of no dependents.",
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
