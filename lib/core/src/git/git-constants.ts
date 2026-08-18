import { GitConstants } from "@workspace/contracts";

export { GitConstants };

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
  UPGRADED_LEGACY_POST_COMMIT_HOOK:
    "Upgraded legacy post-commit hook (docuvia snapshot -> docuvia analyze)",
  UPGRADED_POST_COMMIT_HOOK_FLUSH_L3:
    "Upgraded post-commit hook (added flush-staged-l3 step, issue #42)",
  UPGRADED_POST_COMMIT_HOOK_NOHUP:
    "Upgraded post-commit hook (nohup + log redirect, issue #58)",
  PRE_PUSH_HOOK_ALREADY_INSTALLED: "Pre-push hook already installed",
  CONCURRENT_PRE_PUSH_HOOK_INSTALL_SKIPPED:
    "Pre-push hook was installed by a concurrent process; skipping duplicate append",
  FAILED_TO_INSTALL_PRE_PUSH_HOOK: "Failed to install pre-push hook",
  INSTALLED_PRE_PUSH_HOOK: "Installed pre-push hook",
  UPGRADED_LEGACY_PRE_PUSH_HOOK:
    "Upgraded legacy pre-push hook (added sync-knowledge step)",

  /** `uninstall`'s hook-removal messages (phase1-decision-integration.md §10a). */
  REMOVED_POST_COMMIT_HOOK: "Removed post-commit hook",
  REMOVED_PRE_PUSH_HOOK: "Removed pre-push hook",
  NO_POST_COMMIT_HOOK_TO_REMOVE: "No Docuvia post-commit hook to remove",
  NO_PRE_PUSH_HOOK_TO_REMOVE: "No Docuvia pre-push hook to remove",
  FAILED_TO_REMOVE_POST_COMMIT_HOOK: "Failed to remove post-commit hook",
  FAILED_TO_REMOVE_PRE_PUSH_HOOK: "Failed to remove pre-push hook",
  NO_KNOWLEDGE_BRANCH_TO_DELETE: "No knowledge branch to delete",
  DELETED_KNOWLEDGE_BRANCH: "Deleted hidden knowledge branch",
  FAILED_TO_DELETE_KNOWLEDGE_BRANCH: "Failed to delete knowledge branch",

  /** `doctor --fix`'s repair messages (phase1-decision-integration.md §10d). */
  REPAIRED_DUPLICATE_POST_COMMIT_HOOK:
    "Repaired duplicate post-commit hook block",
  NOTHING_TO_REPAIR: "Nothing to repair -- post-commit hook is not duplicated",
  PACKED_SNAPSHOT_ONTO_BRANCH: "Packed snapshot onto knowledge branch",
  NO_REMOTE_SKIP_RECONCILIATION:
    "No remote configured; skipping knowledge branch reconciliation",
  FAILED_TO_FETCH_CONTINUING_OFFLINE:
    "Failed to fetch knowledge branch from remote; continuing offline",
  /** Git's own stable porcelain message for "the ref you asked to fetch doesn't exist on that
   *  remote" (unchanged across git versions) -- distinguishes a brand-new, never-yet-pushed
   *  knowledge branch (a normal, expected state on a fresh project) from a genuine network/auth
   *  failure. Conflating the two used to mean a project's very first `sync-knowledge` could never
   *  push its knowledge branch to origin at all: the first fetch always hits this exact error
   *  (found via dogfooding Docuvia on Docuvia2 itself, 2026-07-21). */
  REMOTE_REF_NOT_FOUND_TEXT: "couldn't find remote ref",
  REMOTE_KNOWLEDGE_BRANCH_NOT_YET_ON_REMOTE:
    "Knowledge branch does not exist on remote yet; treating as first-ever push",
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
  HYDRATE_REFUSED_PENDING_WRITE:
    "Refused automatic hydration: a knowledge-branch write from this workspace has not been " +
    "confirmed yet (its pack attempt is pending or failed); local.db was left untouched",
  hydrateRefusedCatastrophicShrink: (
    currentNodes: number,
    incomingNodes: number,
  ) =>
    `Refused automatic hydration: the resolved knowledge commit has ${incomingNodes} node(s), ` +
    `a catastrophic reduction from local.db's current ${currentNodes}; local.db was left untouched`,
  /** `IMPORTED_L3_CARDS`'s `logger.info` call (phase2-l3-distribution.md L3DIST-007) — shared by
   *  `HydrationService.hydrate()` and `sync-knowledge`'s post-reconcile import step. */
  IMPORTED_L3_CARDS: "Imported L3 decision cards from knowledge branch",

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
