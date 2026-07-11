import { describe, it, expect, vi } from "vitest";
import { pathToFileURL } from "url";
import path from "path";
import { seedProjectRow } from "./seed-project-row.js";
import { IWorkspaceGitService } from "../../interfaces/workspace-git.interfaces.js";
import type { ProjectsRepo } from "../../memory/repos/projects-repo.js";
import type { ProjectRow } from "@workspace/schema";

function makeMockGit(overrides: Partial<IWorkspaceGitService> = {}): IWorkspaceGitService {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    ensureKnowledgeBranch: vi.fn().mockResolvedValue({ created: true }),
    installPostCommitHook: vi.fn().mockResolvedValue({ installed: true }),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeMockProjectsRepo(existing?: ProjectRow): ProjectsRepo {
  let row = existing;
  return {
    getFirst: vi.fn().mockImplementation(() => row),
    insert: vi.fn().mockImplementation((input: { name: string; repoUrl: string }) => {
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
    }),
  } as unknown as ProjectsRepo;
}

describe("seedProjectRow", () => {
  it("inserts a new project row with the git remote URL as repo_url when a remote is configured", async () => {
    const git = makeMockGit({
      getRemoteUrl: vi.fn().mockResolvedValue("https://github.com/example/repo.git"),
    });
    const projectsRepo = makeMockProjectsRepo();

    const result = await seedProjectRow(projectsRepo, git, "/workspace/my-repo");

    expect(result.repo_url).toBe("https://github.com/example/repo.git");
    expect(projectsRepo.insert).toHaveBeenCalledWith({
      name: "my-repo",
      repoUrl: "https://github.com/example/repo.git",
    });
  });

  it("falls back to a file:// repo_url when no git remote is configured", async () => {
    const git = makeMockGit({ getRemoteUrl: vi.fn().mockResolvedValue(undefined) });
    const projectsRepo = makeMockProjectsRepo();

    const result = await seedProjectRow(projectsRepo, git, "/workspace/my-repo");

    expect(result.repo_url).toBe(pathToFileURL(path.resolve("/workspace/my-repo")).href);
  });

  it("is idempotent: does not call insert() when a project row already exists", async () => {
    const git = makeMockGit();
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

    const result = await seedProjectRow(projectsRepo, git, "/workspace/my-repo");

    expect(result).toEqual(existing);
    expect(projectsRepo.insert).not.toHaveBeenCalled();
    expect(git.getRemoteUrl).not.toHaveBeenCalled();
  });
});
