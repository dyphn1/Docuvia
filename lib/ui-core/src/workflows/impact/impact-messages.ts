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
} as const;

/** Structured-log event names appended to `impact.log` by the `impact` workflow. */
export const IMPACT_EVENTS = {
  START: "impact.start",
  ERROR: "impact.error",
  SUMMARY: "impact.summary",
} as const;
