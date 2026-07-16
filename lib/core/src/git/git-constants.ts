import { GIT_DEFAULT_REMOTE_NAME } from "@workspace/contracts";

/** Docuvia-specific git conventions — the domain semantics layered on top of `IGitProvider`'s raw primitives. */
export const GitConstants = {
  KNOWLEDGE_ROOT: "docuvia-knowledge",
  KNOWLEDGE_DIR_NAME: "knowledge",
  GRAPH_DIR_NAME: "graph",
  NODES_JSONL_NAME: "nodes.jsonl",
  EDGES_JSONL_NAME: "edges.jsonl",
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
  /** Git's conventional name for the default/primary remote — shared with `lib/libgit2` via
   *  `@workspace/contracts`'s `GIT_DEFAULT_REMOTE_NAME` per the Virtual Contracts rule that
   *  values needed by both a Domain Core and a Tech Provider package live in contracts. */
  DEFAULT_REMOTE_NAME: GIT_DEFAULT_REMOTE_NAME,
  /** Prefix for a remote-tracking ref path (`refs/remotes/<remote>/<branch>`), used when reading
   *  the remote's copy of the knowledge branch tip during reconciliation. */
  REMOTE_REF_PREFIX: "refs/remotes/",
  /** The special ref name for the currently checked-out commit, used when walking source HEAD's
   *  ancestry during hydration's nearest-ancestor lookup. */
  HEAD_REF: "HEAD",
  /** One project per local.db (first row created by the `init` workflow). */
  DEFAULT_LOCAL_PROJECT_ID: 1,
  /** `docuvia_meta` key storing the knowledge-branch commit sha `local.db` was last hydrated from (STOR-002). */
  META_KEY_KNOWLEDGE_TIP_SHA: "hydratedKnowledgeSha",
  /** `os.tmpdir()` prefix for `ensureKnowledgeBranch`'s scratch dir used to pack the empty initial snapshot. */
  EMPTY_KNOWLEDGE_TEMP_DIR_PREFIX: "docuvia-empty-knowledge-",
} as const;

/** Log messages and human-readable report text shared across the `git/` domain services. */
export const GitMessages = {
  DETECTED_CHANGES: "Detected changes",
  WORKING_TREE_HEAD: "working tree (HEAD)",
  NO_LOCAL_GRAPH_IMPACT:
    "No local graph impact detected for the changed files.",
  TOP_AFFECTED_FILES: "Top affected files:",
  analysisBase: (base: string) => `Base: ${base}`,
  analysisFilesChanged: (count: number) => `Files changed: ${count}`,
  analysisRiskLevel: (riskLevel: string) => `Risk level: ${riskLevel}`,
  analysisImpactedNodes: (totalImpacted: number, fileCount: number) =>
    `Impacted nodes: ${totalImpacted} across ${fileCount} changed file(s).`,
  analysisAffectedFileLine: (file: string, depCount: number, names: string) =>
    `  - ${file}: ${depCount} dependent(s) [${names}]`,

  KNOWLEDGE_BRANCH_ALREADY_EXISTS: "Knowledge branch already exists",
  CONCURRENT_INITIAL_COMMIT_SKIPPED:
    "Knowledge branch was created by a concurrent process; skipping duplicate initial commit",
  CREATED_KNOWLEDGE_BRANCH: "Created hidden knowledge branch",
  NO_GIT_HOOKS_DIR:
    "No .git/hooks directory; skipping post-commit hook install",
  POST_COMMIT_HOOK_ALREADY_INSTALLED: "Post-commit hook already installed",
  CONCURRENT_HOOK_INSTALL_SKIPPED:
    "Post-commit hook was installed by a concurrent process; skipping duplicate append",
  FAILED_TO_INSTALL_HOOK: "Failed to install post-commit hook",
  INSTALLED_POST_COMMIT_HOOK: "Installed post-commit hook",
  PACKED_SNAPSHOT_ONTO_BRANCH: "Packed snapshot onto knowledge branch",
  NO_REMOTE_SKIP_RECONCILIATION:
    "No remote configured; skipping knowledge branch reconciliation",
  FAILED_TO_FETCH_CONTINUING_OFFLINE:
    "Failed to fetch knowledge branch from remote; continuing offline",
  ADOPTED_REMOTE_BRANCH:
    "Adopted remote knowledge branch (no local copy existed)",
  FAST_FORWARDED_LOCAL_BRANCH:
    "Fast-forwarded local knowledge branch to remote",
  MERGED_DIVERGED_BRANCH: "Merged diverged knowledge branch",
  FAILED_TO_PUSH_WILL_RETRY:
    "Failed to push knowledge branch to remote; will retry on next sync",
  SNAPSHOT_UNKNOWN: "Snapshot [unknown]",
  MERGE_WINNER_LOCAL: "local",
  MERGE_WINNER_REMOTE: "remote",
  mergeCommitMessage: (winnerIsLocal: boolean) =>
    `Merge knowledge branch (${winnerIsLocal ? "local" : "remote"} wins)`,
  snapshotCommitMessage: (sourceSha: string) =>
    `Snapshot [${sourceSha.slice(0, 7)}]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: ${sourceSha}`,

  NOTHING_TO_HYDRATE:
    "Nothing to hydrate from yet — knowledge branch doesn't exist",
  HYDRATED_KNOWLEDGE_GRAPH: "Hydrated knowledge graph from git",

  failedToWriteMarkdown: (id: string, name: string, errMessage: string) =>
    `Failed to write markdown for node ${id} (${name}): ${errMessage}`,
  sanitizedPathEscapesKnowledgeDir: (relPath: string) =>
    `Sanitized markdown path escapes knowledge directory: ${relPath}`,
  markdownFrontmatter: (
    id: string,
    kind: string,
    name: string,
    filePath: string | undefined,
  ) =>
    "---\n" +
    `id: ${id}\n` +
    `type: ${kind}\n` +
    `name: ${name}\n` +
    (filePath ? `filePath: ${filePath}\n` : "") +
    "---\n",
  markdownFileBody: (name: string, filePath: string | undefined) =>
    `# File: ${name}\n\nPath: \`${filePath ?? name}\`\n`,
  markdownSymbolBody: (name: string, filePath: string | undefined) =>
    `# Symbol: ${name}\n\nFile: \`${filePath ?? ""}\`\n`,
} as const;
