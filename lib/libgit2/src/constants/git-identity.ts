/**
 * Synthetic committer identity Docuvia uses for commits it makes on its own behalf — the
 * knowledge branch's `packDirectoryToBranch` (`fast-import.ts`) and tree-adoption merge commits
 * (`Libgit2Provider.createMergeCommit`) — never the local git config.
 */
export const DOCUVIA_GIT_IDENTITY = {
  NAME: "Docuvia",
  EMAIL: "docuvia@localhost",
} as const;
