export const GitConstants = {
  KNOWLEDGE_ROOT: "docuvia-knowledge",
  KNOWLEDGE_BRANCH_COMMIT_MESSAGE: "chore: initialize empty knowledge graph",
  /** The well-known empty-tree SHA — identical in every git repository. */
  EMPTY_TREE_SHA: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  /** Joined via path.join(cwd, ...GIT_HOOKS_DIR). */
  GIT_HOOKS_DIR: [".git", "hooks"] as const,
  POST_COMMIT_HOOK_FILENAME: "post-commit",
  POST_COMMIT_HOOK_MARKER: "docuvia snapshot",
  POST_COMMIT_HOOK_CONTENT:
    `#!/bin/bash\n# Docuvia Knowledge Graph Evolver Hook\n` +
    `# Non-intrusively extracts AST deltas in the background\n` +
    `if command -v npx &> /dev/null; then\n` +
    `  # Fire and forget (do not block commit)\n` +
    `  npx --no-install docuvia snapshot > /dev/null 2>&1 &\n` +
    `fi\n`,
  LOCAL_REMOTE_URL_SCHEME: "file://",
  /**
   * Matches the hardcoded `projectId: 1` convention already baked into
   * SqliteGraphRepository (one project per local.db, first row created by InitService).
   */
  DEFAULT_LOCAL_PROJECT_ID: 1,
} as const;
