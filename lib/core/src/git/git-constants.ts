/** Docuvia-specific git conventions — the domain semantics layered on top of `IGitProvider`'s raw primitives. */
export const GitConstants = {
  KNOWLEDGE_ROOT: "docuvia-knowledge",
  KNOWLEDGE_BRANCH_COMMIT_MESSAGE: "chore: initialize empty knowledge graph",
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
} as const;
