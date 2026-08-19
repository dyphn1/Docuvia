import { describe, it, expect, vi } from "vitest";
import { pathToFileURL } from "url";
import path from "path";
import type {
  IGitProvider,
  IProjectsRepo,
  ProjectRow,
} from "@workspace/contracts";
import { seedProjectRow } from "./seed-project-row.js";

function makeMockGitProvider(
  overrides: Partial<IGitProvider> = {},
): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    branchExists: vi.fn().mockResolvedValue(false),
    deleteBranch: vi.fn().mockResolvedValue(undefined),
    commitEmptyTree: vi.fn().mockResolvedValue("sha"),
    updateBranchRef: vi.fn().mockResolvedValue(undefined),
    hooksDirExists: vi.fn().mockResolvedValue(false),
    resolveHooksDir: vi.fn().mockResolvedValue("/workspace/.git/hooks"),
    readHookFile: vi.fn().mockResolvedValue(undefined),
    appendHookFile: vi.fn().mockResolvedValue(undefined),
    writeHookFile: vi.fn().mockResolvedValue(undefined),
    makeHookExecutable: vi.fn().mockResolvedValue(undefined),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    listWorktrees: vi.fn().mockResolvedValue([]),
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getChangedLineRanges: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    getHeadSha: vi.fn().mockResolvedValue(undefined),
    getBranchTipSha: vi.fn().mockResolvedValue(undefined),
    readFileAtRef: vi.fn().mockResolvedValue(undefined),
    listFilesAtRef: vi.fn().mockResolvedValue([]),
    getCommitLog: vi.fn().mockResolvedValue([]),
    getCommitAncestry: vi.fn().mockResolvedValue([]),
    packDirectoryToBranch: vi.fn().mockResolvedValue(undefined),
    fetchRef: vi.fn().mockResolvedValue(undefined),
    pushRef: vi.fn().mockResolvedValue(undefined),
    getRefSha: vi.fn().mockResolvedValue(undefined),
    isAncestor: vi.fn().mockResolvedValue(false),
    getTreeSha: vi.fn().mockResolvedValue("tree-sha"),
    getCommitTimestamp: vi.fn().mockResolvedValue(0),
    createMergeCommit: vi.fn().mockResolvedValue("merge-sha"),
    acquireKnowledgeLock: vi.fn().mockResolvedValue(undefined),
    releaseKnowledgeLock: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockProjectsRepo(existing?: ProjectRow): IProjectsRepo {
  let row = existing;
  const doInsert = (input: { name: string; repoUrl: string }) => {
    row = {
      id: 1,
      name: input.name,
      repo_url: input.repoUrl,
      description: null,
      status: "active",
      vcs_type: "git",
      svn_url: null,
      last_git_ingested_at: null,
      last_svn_revision: null,
      last_ast_ingested_at: null,
      owner_id: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    return row;
  };
  return {
    getFirst: vi.fn().mockImplementation(() => row),
    insert: vi.fn().mockImplementation(doInsert),
    getOrInsert: vi
      .fn()
      .mockImplementation((input: { name: string; repoUrl: string }) =>
        row ? row : doInsert(input),
      ),
    count: vi.fn().mockImplementation(() => (row ? 1 : 0)),
  };
}

describe("seedProjectRow", () => {
  it("inserts a new project row with the git remote URL as repo_url when a remote is configured", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi
        .fn()
        .mockResolvedValue("https://github.com/example/repo.git"),
    });
    const projectsRepo = makeMockProjectsRepo();

    const result = await seedProjectRow(
      projectsRepo,
      git,
      "/workspace/my-repo",
    );

    expect(result.repo_url).toBe("https://github.com/example/repo.git");
    expect(projectsRepo.getOrInsert).toHaveBeenCalledWith({
      name: "my-repo",
      repoUrl: "https://github.com/example/repo.git",
    });
  });

  it("falls back to a file:// repo_url when no git remote is configured", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    });
    const projectsRepo = makeMockProjectsRepo();

    const result = await seedProjectRow(
      projectsRepo,
      git,
      "/workspace/my-repo",
    );

    expect(result.repo_url).toBe(
      pathToFileURL(path.resolve("/workspace/my-repo")).href,
    );
  });

  it("is idempotent: does not call insert() when a project row already exists", async () => {
    const git = makeMockGitProvider();
    const existing: ProjectRow = {
      id: 1,
      name: "my-repo",
      repo_url: "file:///workspace/my-repo",
      description: null,
      status: "active",
      vcs_type: "git",
      svn_url: null,
      last_git_ingested_at: null,
      last_svn_revision: null,
      last_ast_ingested_at: null,
      owner_id: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const projectsRepo = makeMockProjectsRepo(existing);

    const result = await seedProjectRow(
      projectsRepo,
      git,
      "/workspace/my-repo",
    );

    expect(result).toEqual(existing);
    expect(projectsRepo.insert).not.toHaveBeenCalled();
    expect(git.getRemoteUrl).not.toHaveBeenCalled();
  });
});
