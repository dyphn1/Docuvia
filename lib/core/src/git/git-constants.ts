/** Docuvia-specific git conventions — the domain semantics layered on top of `IGitProvider`'s raw primitives. */
export const GitConstants = {
  KNOWLEDGE_ROOT: "docuvia-knowledge",
  /** Commit-message trailer key (STOR-001 point 4) carrying the full 40-char source-commit sha, read back by Phase 2's nearest-ancestor hydration lookup. */
  SOURCE_COMMIT_TRAILER_KEY: "Docuvia-Source",
  POST_COMMIT_HOOK_NAME: "post-commit",
  POST_COMMIT_HOOK_MARKER: "docuvia snapshot",
  POST_COMMIT_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Knowledge Graph Evolver Hook\n` +
    `# Non-intrusively extracts AST deltas in the background\n` +
    `if command -v npx &> /dev/null; then\n` +
    `  # Fire and forget (do not block commit)\n` +
    `  npx --no-install docuvia snapshot > /dev/null 2>&1 &\n` +
    `fi\n`,
  LOCAL_REMOTE_URL_SCHEME: "file://",
  /** One project per local.db (first row created by the `init` workflow). */
  DEFAULT_LOCAL_PROJECT_ID: 1,
  /** `docuvia_meta` key storing the knowledge-branch commit sha `local.db` was last hydrated from (STOR-002). */
  META_KEY_KNOWLEDGE_TIP_SHA: "hydratedKnowledgeSha",
  /**
   * `docuvia_meta` key storing the source commit sha `local.db`'s graph was last *ingested*
   * from — distinct from `META_KEY_KNOWLEDGE_TIP_SHA`, which tracks the last git *hydration*
   * (phase1-decision-integration.md §6a; PLAT-007 Tier A). Written after every successful full or
   * delta `analyze` auto-mode ingestion; read back as the idempotency fast-path (`HEAD ===` this
   * value → no-op) and as the delta baseline (`this value -> HEAD`).
   */
  META_KEY_LAST_INGESTED_SOURCE_SHA: "lastIngestedSourceSha",
  /**
   * `docuvia_meta` key holding a JSON array of `{file, commitSha}` entries, deduped by `file` —
   * the Tier B queue `analyze` auto mode's delta ingestion enqueues `CONTRACT_CHANGED` files into
   * (phase1-decision-integration.md §6b; PLAT-007 Tier B). Not consumed until Slice 3.
   */
  META_KEY_TIER_B_QUEUE: "tierBQueue",
} as const;
