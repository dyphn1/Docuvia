import { describe, it, expect, vi } from "vitest";
import type { IGitProvider } from "@workspace/contracts";
import { createMockLogger } from "@workspace/contracts";
import { KnowledgeGitService } from "./knowledge-git.service.js";
import { GitConstants } from "./git-constants.js";

function makeMockGitProvider(
  overrides: Partial<IGitProvider> = {},
): IGitProvider {
  return {
    isGitRepository: vi.fn().mockResolvedValue(true),
    branchExists: vi.fn().mockResolvedValue(false),
    commitEmptyTree: vi.fn().mockResolvedValue("deadbeef"),
    updateBranchRef: vi.fn().mockResolvedValue(undefined),
    hooksDirExists: vi.fn().mockResolvedValue(true),
    readHookFile: vi.fn().mockResolvedValue(undefined),
    appendHookFile: vi.fn().mockResolvedValue(undefined),
    makeHookExecutable: vi.fn().mockResolvedValue(undefined),
    listTrackedFilesWithBlobHash: vi.fn().mockResolvedValue(new Map()),
    listUntrackedFiles: vi.fn().mockResolvedValue([]),
    listModifiedFiles: vi.fn().mockResolvedValue([]),
    readBlobContent: vi.fn().mockResolvedValue(""),
    getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    getRecentChangedFilePaths: vi.fn().mockResolvedValue([]),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    getChangedFilesSince: vi.fn().mockResolvedValue([]),
    getFilesChangedByCommit: vi.fn().mockResolvedValue([]),
    getHeadSha: vi
      .fn()
      .mockResolvedValue("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"),
    getBranchTipSha: vi.fn().mockResolvedValue(undefined),
    readFileAtRef: vi.fn().mockResolvedValue(undefined),
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

describe("KnowledgeGitService.ensureKnowledgeBranch()", () => {
  it("creates the branch via the same packDirectoryToBranch mechanism as snapshot, stamped with the source HEAD hash, when it does not already exist", async () => {
    const git = makeMockGitProvider({
      branchExists: vi.fn().mockResolvedValue(false),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.ensureKnowledgeBranch("/workspace");

    expect(result).toEqual({ created: true });
    expect(git.commitEmptyTree).not.toHaveBeenCalled();
    expect(git.updateBranchRef).not.toHaveBeenCalled();
    expect(git.packDirectoryToBranch).toHaveBeenCalledTimes(1);
    const [cwd, sourceDir, branchName, commitMessage] = (
      git.packDirectoryToBranch as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(cwd).toBe("/workspace");
    expect(typeof sourceDir).toBe("string");
    expect(branchName).toBe(GitConstants.KNOWLEDGE_ROOT);
    expect(commitMessage).toBe(
      "Snapshot [a1b2c3d]\n\nDocuvia-Source: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    );
  });

  it("is idempotent: does not create a commit when the branch already exists", async () => {
    const git = makeMockGitProvider({
      branchExists: vi.fn().mockResolvedValue(true),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.ensureKnowledgeBranch("/workspace");

    expect(result).toEqual({ created: false });
    expect(git.packDirectoryToBranch).not.toHaveBeenCalled();
  });

  it("propagates a failure from the underlying git provider (fatal to init)", async () => {
    const git = makeMockGitProvider({
      packDirectoryToBranch: vi
        .fn()
        .mockRejectedValue(new Error("git fast-import failed")),
    });
    const service = new KnowledgeGitService(git);

    await expect(service.ensureKnowledgeBranch("/workspace")).rejects.toThrow(
      "git fast-import failed",
    );
  });
});

describe("KnowledgeGitService.installPostCommitHook()", () => {
  it("installs the hook when .git/hooks exists and no marker is present yet", async () => {
    const git = makeMockGitProvider();
    const service = new KnowledgeGitService(git);

    const result = await service.installPostCommitHook("/workspace");

    expect(result).toEqual({ installed: true });
    expect(git.appendHookFile).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.POST_COMMIT_HOOK_NAME,
      GitConstants.POST_COMMIT_HOOK_CONTENT,
    );
    expect(git.makeHookExecutable).toHaveBeenCalled();
  });

  it("does not install (non-fatal) when .git/hooks does not exist", async () => {
    const git = makeMockGitProvider({
      hooksDirExists: vi.fn().mockResolvedValue(false),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.installPostCommitHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(git.appendHookFile).not.toHaveBeenCalled();
  });

  it("is idempotent: does not duplicate the hook when the marker is already present", async () => {
    const git = makeMockGitProvider({
      readHookFile: vi
        .fn()
        .mockResolvedValue(
          `#!/bin/bash\n${GitConstants.POST_COMMIT_HOOK_MARKER}\n`,
        ),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.installPostCommitHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(git.appendHookFile).not.toHaveBeenCalled();
  });

  it("does not throw when writing the hook fails — logs a warning and reports installed:false instead", async () => {
    const git = makeMockGitProvider({
      appendHookFile: vi.fn().mockRejectedValue(new Error("EACCES")),
    });
    const logger = createMockLogger();
    const service = new KnowledgeGitService(git, logger);

    const result = await service.installPostCommitHook("/workspace");

    expect(result).toEqual({ installed: false });
    expect(logger.events.some((e) => e.level === "warn")).toBe(true);
  });
});

describe("KnowledgeGitService.packSnapshotToKnowledgeBranch()", () => {
  it("delegates to IGitProvider.packDirectoryToBranch with the default knowledge branch name and a source-hash-stamped commit message", async () => {
    const git = makeMockGitProvider();
    const service = new KnowledgeGitService(git);

    await service.packSnapshotToKnowledgeBranch(
      "/workspace",
      "/tmp/snapshot-render",
    );

    expect(git.packDirectoryToBranch).toHaveBeenCalledWith(
      "/workspace",
      "/tmp/snapshot-render",
      GitConstants.KNOWLEDGE_ROOT,
      "Snapshot [a1b2c3d]\n\nDocuvia-Source: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    );
  });

  it("uses an explicit branchName override when given", async () => {
    const git = makeMockGitProvider();
    const service = new KnowledgeGitService(git);

    await service.packSnapshotToKnowledgeBranch(
      "/workspace",
      "/tmp/snapshot-render",
      "custom-branch",
    );

    expect(git.packDirectoryToBranch).toHaveBeenCalledWith(
      "/workspace",
      "/tmp/snapshot-render",
      "custom-branch",
      "Snapshot [a1b2c3d]\n\nDocuvia-Source: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    );
  });

  it("falls back to an unstamped message on an unborn HEAD (no source commits yet)", async () => {
    const git = makeMockGitProvider({
      getHeadSha: vi.fn().mockResolvedValue(undefined),
    });
    const service = new KnowledgeGitService(git);

    await service.packSnapshotToKnowledgeBranch(
      "/workspace",
      "/tmp/snapshot-render",
    );

    expect(git.packDirectoryToBranch).toHaveBeenCalledWith(
      "/workspace",
      "/tmp/snapshot-render",
      GitConstants.KNOWLEDGE_ROOT,
      "Snapshot [unknown]",
    );
  });

  it("propagates a failure from the underlying git provider", async () => {
    const git = makeMockGitProvider({
      packDirectoryToBranch: vi
        .fn()
        .mockRejectedValue(new Error("git fast-import failed")),
    });
    const service = new KnowledgeGitService(git);

    await expect(
      service.packSnapshotToKnowledgeBranch(
        "/workspace",
        "/tmp/snapshot-render",
      ),
    ).rejects.toThrow("git fast-import failed");
  });
});

describe("KnowledgeGitService.syncKnowledgeBranch()", () => {
  it("is a no-op (status: no-remote) when there's no origin remote configured", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue(undefined),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({ status: "no-remote" });
    expect(git.fetchRef).not.toHaveBeenCalled();
  });

  it("degrades gracefully (status: no-remote) when fetch fails — e.g. offline", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      fetchRef: vi.fn().mockRejectedValue(new Error("could not resolve host")),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({ status: "no-remote" });
  });

  it("is up-to-date when local and remote tips already match", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("sha-1"),
      getRefSha: vi.fn().mockResolvedValue("sha-1"),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({ status: "up-to-date", branchTipSha: "sha-1" });
    expect(git.updateBranchRef).not.toHaveBeenCalled();
    expect(git.pushRef).not.toHaveBeenCalled();
  });

  it("adopts the remote wholesale when there's no local copy yet", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue(undefined),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({
      status: "fast-forwarded-local",
      branchTipSha: "remote-sha",
    });
    expect(git.updateBranchRef).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.KNOWLEDGE_ROOT,
      "remote-sha",
    );
  });

  it("pushes the local branch when the remote has no copy yet", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue(undefined),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({
      status: "pushed-local",
      branchTipSha: "local-sha",
    });
    expect(git.pushRef).toHaveBeenCalledWith(
      "/workspace",
      "origin",
      GitConstants.KNOWLEDGE_ROOT,
    );
  });

  it("fast-forwards local to remote when remote is strictly ahead", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
      isAncestor: vi
        .fn()
        .mockImplementation((_cwd, ancestor, descendant) =>
          Promise.resolve(
            ancestor === "local-sha" && descendant === "remote-sha",
          ),
        ),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({
      status: "fast-forwarded-local",
      branchTipSha: "remote-sha",
    });
    expect(git.updateBranchRef).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.KNOWLEDGE_ROOT,
      "remote-sha",
    );
    expect(git.createMergeCommit).not.toHaveBeenCalled();
  });

  it("pushes local to remote when local is strictly ahead", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
      isAncestor: vi
        .fn()
        .mockImplementation((_cwd, ancestor, descendant) =>
          Promise.resolve(
            ancestor === "remote-sha" && descendant === "local-sha",
          ),
        ),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({
      status: "pushed-local",
      branchTipSha: "local-sha",
    });
    expect(git.pushRef).toHaveBeenCalledWith(
      "/workspace",
      "origin",
      GitConstants.KNOWLEDGE_ROOT,
    );
    expect(git.createMergeCommit).not.toHaveBeenCalled();
  });

  it("on true divergence, picks the winner whose stamped source commit is the topological descendant, adopts its tree, and pushes the merge", async () => {
    const sourceOld = "source-old-sha";
    const sourceNew = "source-new-sha";
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
      isAncestor: vi.fn().mockImplementation((_cwd, ancestor, descendant) => {
        // Neither commit is a fast-forward ancestor of the other (true divergence)...
        if (ancestor === "local-sha" || ancestor === "remote-sha")
          return Promise.resolve(false);
        // ...but remote's stamped source is a descendant of local's — remote wins.
        return Promise.resolve(
          ancestor === sourceOld && descendant === sourceNew,
        );
      }),
      getCommitLog: vi.fn().mockImplementation((_cwd, ref) => {
        if (ref === "local-sha") {
          return Promise.resolve([
            {
              sha: "local-sha",
              message: `Snapshot [aaa]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: ${sourceOld}`,
            },
          ]);
        }
        if (ref === "remote-sha") {
          return Promise.resolve([
            {
              sha: "remote-sha",
              message: `Snapshot [bbb]\n\n${GitConstants.SOURCE_COMMIT_TRAILER_KEY}: ${sourceNew}`,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
      getTreeSha: vi.fn().mockResolvedValue("remote-tree"),
      createMergeCommit: vi.fn().mockResolvedValue("merge-sha"),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({ status: "merged", branchTipSha: "merge-sha" });
    expect(git.getTreeSha).toHaveBeenCalledWith("/workspace", "remote-sha");
    expect(git.createMergeCommit).toHaveBeenCalledWith(
      "/workspace",
      "remote-tree",
      ["local-sha", "remote-sha"],
      expect.stringContaining("remote wins"),
    );
    expect(git.updateBranchRef).toHaveBeenCalledWith(
      "/workspace",
      GitConstants.KNOWLEDGE_ROOT,
      "merge-sha",
    );
    expect(git.pushRef).toHaveBeenCalledWith(
      "/workspace",
      "origin",
      GitConstants.KNOWLEDGE_ROOT,
    );
  });

  it("on true divergence with unstamped/unrelated source commits, falls back to the newer committer timestamp", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
      isAncestor: vi.fn().mockResolvedValue(false),
      getCommitLog: vi.fn().mockResolvedValue([]), // no Docuvia-Source trailer on either side
      getCommitTimestamp: vi
        .fn()
        .mockImplementation((_cwd, sha) =>
          Promise.resolve(sha === "local-sha" ? 100 : 200),
        ),
      getTreeSha: vi.fn().mockResolvedValue("local-tree"),
      createMergeCommit: vi.fn().mockResolvedValue("merge-sha"),
    });
    const service = new KnowledgeGitService(git);

    await service.syncKnowledgeBranch("/workspace");

    // remote-sha has the newer timestamp (200 > 100), so it should win.
    expect(git.getTreeSha).toHaveBeenCalledWith("/workspace", "remote-sha");
  });

  it("still returns status:merged when the post-merge push fails (degrades gracefully offline)", async () => {
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      getBranchTipSha: vi.fn().mockResolvedValue("local-sha"),
      getRefSha: vi.fn().mockResolvedValue("remote-sha"),
      isAncestor: vi.fn().mockResolvedValue(false),
      getCommitLog: vi.fn().mockResolvedValue([]),
      getCommitTimestamp: vi.fn().mockResolvedValue(0),
      getTreeSha: vi.fn().mockResolvedValue("some-tree"),
      createMergeCommit: vi.fn().mockResolvedValue("merge-sha"),
      pushRef: vi.fn().mockRejectedValue(new Error("connection reset")),
    });
    const service = new KnowledgeGitService(git);

    const result = await service.syncKnowledgeBranch("/workspace");

    expect(result).toEqual({ status: "merged", branchTipSha: "merge-sha" });
  });

  it("holds the knowledge branch lock for the duration of the reconciliation", async () => {
    const order: string[] = [];
    const git = makeMockGitProvider({
      getRemoteUrl: vi.fn().mockResolvedValue("https://example.com/repo.git"),
      acquireKnowledgeLock: vi.fn().mockImplementation(async () => {
        order.push("acquire");
      }),
      releaseKnowledgeLock: vi.fn().mockImplementation(async () => {
        order.push("release");
      }),
      getBranchTipSha: vi.fn().mockImplementation(async () => {
        order.push("reconcile");
        return "sha-1";
      }),
      getRefSha: vi.fn().mockResolvedValue("sha-1"),
    });
    const service = new KnowledgeGitService(git);

    await service.syncKnowledgeBranch("/workspace");

    expect(order).toEqual(["acquire", "reconcile", "release"]);
  });
});
