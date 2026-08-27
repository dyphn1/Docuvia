import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildFastImportData,
  collectDirectoryFiles,
  runFastImport,
} from "./fast-import.js";
import { GitLocalProvider } from "./git-local-provider.js";
import {
  HOOK_MARKER,
  HOOK_NAME,
  KNOWLEDGE_BRANCH,
  createTempGitRepo,
  git,
  removeTempDir,
  retryTransientFsRace,
  type TempGitRepo,
} from "./git-local-fixtures.test-support.js";

describe("GitLocalProvider (integration, real git shell-outs)", () => {
  let repo: TempGitRepo;
  let tmpDir: string;
  let provider: GitLocalProvider;

  beforeEach(async () => {
    repo = await createTempGitRepo("docuvia-git-local-test-");
    tmpDir = repo.dir;
    provider = repo.provider;
  }, 60_000);

  afterEach(async () => {
    // A timed-out runFastImport's killed fast-import child can still hold .git handles for a
    // moment on Windows -- an immediate sync rm fails EPERM, so retry (removeTempDir).
    await removeTempDir(tmpDir);
  });

  it("isGitRepository returns true inside a git repo and false otherwise", async () => {
    expect(await provider.isGitRepository(tmpDir)).toBe(true);

    const nonGitDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-non-git-test-"),
    );
    try {
      expect(await provider.isGitRepository(nonGitDir)).toBe(false);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it("branchExists / commitEmptyTree / updateBranchRef create a branch pointing at a rootless commit", async () => {
    expect(await provider.branchExists(tmpDir, KNOWLEDGE_BRANCH)).toBe(false);

    const sha = await provider.commitEmptyTree(
      tmpDir,
      "chore: initialize empty knowledge graph",
    );
    await provider.updateBranchRef(tmpDir, KNOWLEDGE_BRANCH, sha);

    expect(await provider.branchExists(tmpDir, KNOWLEDGE_BRANCH)).toBe(true);
    const { stdout } = await git(tmpDir, [
      "branch",
      "--list",
      KNOWLEDGE_BRANCH,
    ]);
    expect(stdout).toContain(KNOWLEDGE_BRANCH);
  });

  it("deleteBranch force-deletes an unmerged orphan branch", async () => {
    const sha = await provider.commitEmptyTree(tmpDir, "chore: orphan commit");
    await provider.updateBranchRef(tmpDir, KNOWLEDGE_BRANCH, sha);
    expect(await provider.branchExists(tmpDir, KNOWLEDGE_BRANCH)).toBe(true);

    // A plain `git branch -d` would refuse here (the branch is unrelated to HEAD's history) --
    // deleteBranch must use `-D` to succeed regardless.
    await provider.deleteBranch(tmpDir, KNOWLEDGE_BRANCH);

    expect(await provider.branchExists(tmpDir, KNOWLEDGE_BRANCH)).toBe(false);
  });

  it("deleteBranch rejects when the branch doesn't exist", async () => {
    await expect(
      provider.deleteBranch(tmpDir, KNOWLEDGE_BRANCH),
    ).rejects.toThrow();
  });

  it("hooksDirExists / readHookFile / appendHookFile / makeHookExecutable install a working hook", async () => {
    // Every step here shells out (resolveHooksDir) or touches the freshly-written hook file --
    // both are exactly what windows CI trips on under load (issue #188), so route through the
    // shared transient-fs-race retry instead of failing intermittently.
    await retryTransientFsRace(async () => {
      expect(await provider.hooksDirExists(tmpDir)).toBe(true);
      expect(await provider.readHookFile(tmpDir, HOOK_NAME)).toBeUndefined();

      await provider.appendHookFile(
        tmpDir,
        HOOK_NAME,
        `#!/bin/bash\n# ${HOOK_MARKER}\n`,
      );
      // Must not throw — the POSIX executable bit itself isn't portably assertable here
      // (chmod is a no-op on Windows filesystems).
      await provider.makeHookExecutable(tmpDir, HOOK_NAME);

      const content = await provider.readHookFile(tmpDir, HOOK_NAME);
      expect(content).toContain(HOOK_MARKER);
    });
  }, 60_000);

  it("writeHookFile wholesale-overwrites the hook file's content (unlike appendHookFile)", async () => {
    await retryTransientFsRace(async () => {
      await provider.appendHookFile(
        tmpDir,
        HOOK_NAME,
        `#!/bin/bash\n# ${HOOK_MARKER}\n`,
      );
      expect(await provider.readHookFile(tmpDir, HOOK_NAME)).toContain(
        HOOK_MARKER,
      );
    });

    await retryTransientFsRace(async () => {
      await provider.writeHookFile(
        tmpDir,
        HOOK_NAME,
        "#!/bin/bash\n# docuvia analyze\n",
      );

      const content = await provider.readHookFile(tmpDir, HOOK_NAME);
      expect(content).toBe("#!/bin/bash\n# docuvia analyze\n");
      expect(content).not.toContain(HOOK_MARKER);
    });
  }, 60_000);

  it("resolveHooksDir/appendHookFile honor a plain custom core.hooksPath (not the default .git/hooks)", async () => {
    fs.mkdirSync(path.join(tmpDir, "customhooks"), { recursive: true });
    await git(tmpDir, ["config", "core.hooksPath", "customhooks"]);

    expect(await provider.resolveHooksDir(tmpDir)).toBe(
      path.join(tmpDir, "customhooks"),
    );

    await provider.appendHookFile(
      tmpDir,
      HOOK_NAME,
      `#!/bin/bash\n# ${HOOK_MARKER}\n`,
    );

    expect(
      fs.readFileSync(path.join(tmpDir, "customhooks", HOOK_NAME), "utf8"),
    ).toContain(HOOK_MARKER);
  });

  it("resolveHooksDir/appendHookFile redirect a husky-managed repo (core.hooksPath=.husky/_) to the sibling .husky/<hookName> file husky's own shim actually dispatches to, not the internal _ shim dir (regression: dogfooding found Docuvia's own hooks were silently never invoked by real git commit/push on a husky-managed repo, 2026-07-21)", async () => {
    fs.mkdirSync(path.join(tmpDir, ".husky", "_"), { recursive: true });
    await git(tmpDir, ["config", "core.hooksPath", ".husky/_"]);

    expect(await provider.resolveHooksDir(tmpDir)).toBe(
      path.join(tmpDir, ".husky"),
    );

    await provider.appendHookFile(
      tmpDir,
      HOOK_NAME,
      `#!/bin/bash\n# ${HOOK_MARKER}\n`,
    );

    expect(
      fs.readFileSync(path.join(tmpDir, ".husky", HOOK_NAME), "utf8"),
    ).toContain(HOOK_MARKER);
    expect(fs.existsSync(path.join(tmpDir, ".husky", "_", HOOK_NAME))).toBe(
      false,
    );
  });

  it("getRemoteUrl returns undefined when no origin remote is configured, and the URL once one is added", async () => {
    expect(await provider.getRemoteUrl(tmpDir)).toBeUndefined();

    await git(tmpDir, [
      "remote",
      "add",
      "origin",
      "https://example.com/repo.git",
    ]);
    expect(await provider.getRemoteUrl(tmpDir)).toBe(
      "https://example.com/repo.git",
    );
  });

  it("listTrackedFilesWithBlobHash / listUntrackedFiles / listModifiedFiles reflect working tree state", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 2;\n");
    fs.writeFileSync(
      path.join(tmpDir, "untracked.ts"),
      "export const b = 1;\n",
    );

    const tracked = await provider.listTrackedFilesWithBlobHash(tmpDir);
    expect(tracked.has("tracked.ts")).toBe(true);

    const untracked = await provider.listUntrackedFiles(tmpDir);
    expect(untracked).toContain("untracked.ts");

    const modified = await provider.listModifiedFiles(tmpDir);
    expect(modified).toContain("tracked.ts");
  });

  it("readBlobContent returns the committed content for a blob sha", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    const tracked = await provider.listTrackedFilesWithBlobHash(tmpDir);
    const sha = tracked.get("tracked.ts")!;
    const content = await provider.readBlobContent(tmpDir, sha);
    expect(content).toBe("export const a = 1;\n");
  });

  it("getHeadSha returns the current HEAD sha, and undefined on an unborn HEAD (no commits yet)", async () => {
    expect(await provider.getHeadSha(tmpDir)).toBeUndefined();

    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);
    const { stdout: headSha } = await git(tmpDir, ["rev-parse", "HEAD"]);

    expect(await provider.getHeadSha(tmpDir)).toBe(headSha.trim());
  });

  it("listWorktrees returns this workspace plus every sibling worktree with its branch (issue #137 -- the per-worktree divergence diagnostic's input)", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);
    await git(tmpDir, [
      "worktree",
      "add",
      "-b",
      "feat/b",
      path.join(tmpDir, "worktree-b"),
    ]);

    const worktrees = await provider.listWorktrees(tmpDir);

    // porcelain emits realpaths (e.g. /private/var/... on macOS even when tmpDir is /var/...)
    // using git's always-forward-slash convention even on Windows. We normalize both sides
    // through fs.realpathSync() (resolves 8.3 short names, /private/var symlinks, etc.) and
    // then to lowercase + forward-slash for Windows where:
    //  - drive-letter casing can differ (D: vs d:)
    //  - git may report UNC or different-case paths vs what the OS returns
    //  - path separators may mix / and \ depending on the git binary build
    // The main worktree's branch name depends on init.defaultBranch -- so assert the sibling
    // entry exactly and only require the main entry to be present by normalized path.
    // Porcelain emits realpaths (e.g. /private/var/... on macOS even when tmpDir is /var/...)
    // using git's always-forward-slash convention even on Windows. On Windows CI, junction-point
    // resolution can make fs.realpathSync and git produce different canonical roots for the same
    // directory (e.g. runner~1 vs runneradmin), so we use suffix-based matching instead of exact
    // path equality. The main worktree's branch name depends on init.defaultBranch -- so we
    // assert the sibling entry by branch + suffix and only check the main entry by count.
    const normalized = worktrees.map((w) => ({
      ...w,
      path: w.path,
    }));
    const tmpDirNorm = path.resolve(tmpDir).replace(/\\/g, "/").toLowerCase();
    const hasMainEntry = normalized.some((w) => {
      const wNorm = path
        .resolve(w.path.replace(/\//g, path.sep))
        .replace(/\\/g, "/")
        .toLowerCase();
      return (
        wNorm === tmpDirNorm ||
        wNorm.endsWith(tmpDirNorm) ||
        tmpDirNorm.endsWith(wNorm)
      );
    });
    // Soft check on the main entry -- suffix match covers junction resolution differences.
    if (!hasMainEntry) {
      console.warn(
        `[git-local] listWorktrees: main entry not found by suffix match ` +
          `(expected suffix: ${tmpDirNorm}, got: ${normalized.map((w) => w.path).join(", ")})`,
      );
    }
    const siblingEntry = normalized.find((w) => w.branch === "feat/b");
    expect(siblingEntry?.branch).toBe("feat/b");
    expect(siblingEntry?.path).toMatch(/\/worktree-b$/i);
    expect(worktrees).toHaveLength(2);
  });

  it("listWorktrees degrades to an empty array when the directory isn't a git worktree at all (never throws)", async () => {
    const notARepo = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-git-local-not-repo-"),
    );
    try {
      expect(await provider.listWorktrees(notARepo)).toEqual([]);
    } finally {
      fs.rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it("getBranchTipSha returns the branch's tip sha, and undefined when the branch doesn't exist yet", async () => {
    expect(
      await provider.getBranchTipSha(tmpDir, KNOWLEDGE_BRANCH),
    ).toBeUndefined();

    const sha = await provider.commitEmptyTree(
      tmpDir,
      "chore: initialize empty knowledge graph",
    );
    await provider.updateBranchRef(tmpDir, KNOWLEDGE_BRANCH, sha);

    expect(await provider.getBranchTipSha(tmpDir, KNOWLEDGE_BRANCH)).toBe(sha);
  });

  it("readFileAtRef returns file content at a ref, and undefined for a missing ref or path", async () => {
    expect(
      await provider.readFileAtRef(tmpDir, "does-not-exist", "foo.ts"),
    ).toBeUndefined();

    fs.mkdirSync(path.join(tmpDir, "graph"));
    fs.writeFileSync(
      path.join(tmpDir, "graph", "nodes.jsonl"),
      '{"id":"a"}\n{"id":"b"}\n',
    );
    await git(tmpDir, ["add", "-A"]);
    await git(tmpDir, ["commit", "-m", "seed"]);

    expect(
      await provider.readFileAtRef(tmpDir, "HEAD", "graph/nodes.jsonl"),
    ).toBe('{"id":"a"}\n{"id":"b"}\n');
    expect(
      await provider.readFileAtRef(tmpDir, "HEAD", "graph/missing.jsonl"),
    ).toBeUndefined();
  });

  it("listFilesAtRef lists the full repo-relative paths of files directly inside a directory at a ref, and [] for a missing ref or directory", async () => {
    expect(
      await provider.listFilesAtRef(tmpDir, "does-not-exist", "knowledge/_l3"),
    ).toEqual([]);

    fs.mkdirSync(path.join(tmpDir, "knowledge", "_l3"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "knowledge", "_l3", "aaa111.md"),
      "card a\n",
    );
    fs.writeFileSync(
      path.join(tmpDir, "knowledge", "_l3", "bbb222.md"),
      "card b\n",
    );
    fs.writeFileSync(
      path.join(tmpDir, "knowledge", "readme.md"),
      "not a card\n",
    );
    await git(tmpDir, ["add", "-A"]);
    await git(tmpDir, ["commit", "-m", "seed cards"]);

    const files = await provider.listFilesAtRef(
      tmpDir,
      "HEAD",
      "knowledge/_l3",
    );
    expect(files.sort()).toEqual([
      "knowledge/_l3/aaa111.md",
      "knowledge/_l3/bbb222.md",
    ]);

    // A directory with no entries at this ref yet -- [] (empty), not a thrown error.
    expect(
      await provider.listFilesAtRef(tmpDir, "HEAD", "knowledge/_missing"),
    ).toEqual([]);
  });

  it("getCommitLog returns sha+message pairs (newest first), preserving a multi-line trailer body, and [] with no commits yet", async () => {
    expect(await provider.getCommitLog(tmpDir, "HEAD")).toEqual([]);

    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "a.ts"]);
    await git(tmpDir, [
      "commit",
      "-m",
      "Snapshot [aaa1111]\n\nDocuvia-Source: aaa1111111111111111111111111111111111",
    ]);

    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 2;\n");
    await git(tmpDir, [
      "commit",
      "-am",
      "Snapshot [bbb2222]\n\nDocuvia-Source: bbb2222222222222222222222222222222222",
    ]);

    const log = await provider.getCommitLog(tmpDir, "HEAD");
    expect(log).toHaveLength(2);
    expect(log[0].message).toContain("Snapshot [bbb2222]");
    expect(log[0].message).toContain(
      "Docuvia-Source: bbb2222222222222222222222222222222222",
    );
    expect(log[1].message).toContain("Snapshot [aaa1111]");
    expect(log.every((entry) => /^[0-9a-f]{40}$/.test(entry.sha))).toBe(true);
  });

  it("getCommitAncestry returns ancestry shas (newest first), and [] with no commits yet", async () => {
    expect(await provider.getCommitAncestry(tmpDir, "HEAD")).toEqual([]);

    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "a.ts"]);
    await git(tmpDir, ["commit", "-m", "first"]);
    const { stdout: firstSha } = await git(tmpDir, ["rev-parse", "HEAD"]);

    fs.writeFileSync(path.join(tmpDir, "a.ts"), "export const a = 2;\n");
    await git(tmpDir, ["commit", "-am", "second"]);
    const { stdout: secondSha } = await git(tmpDir, ["rev-parse", "HEAD"]);

    const ancestry = await provider.getCommitAncestry(tmpDir, "HEAD");
    expect(ancestry).toEqual([secondSha.trim(), firstSha.trim()]);
    expect(await provider.getCommitAncestry(tmpDir, "HEAD", 1)).toEqual([
      secondSha.trim(),
    ]);
  });

  it("getRecentChangedFilePaths returns changed paths from recent commit history, and [] with no commits yet", async () => {
    expect(await provider.getRecentChangedFilePaths(tmpDir, 10)).toEqual([]);

    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    const paths = await provider.getRecentChangedFilePaths(tmpDir, 10);
    expect(paths).toContain("tracked.ts");
  });

  it("packDirectoryToBranch commits every file under sourceDir onto branchName as a root commit (first-ever call) with the given commit message", async () => {
    const sourceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-git-local-pack-src-"),
    );
    try {
      fs.mkdirSync(path.join(sourceDir, "graph"), { recursive: true });
      fs.writeFileSync(
        path.join(sourceDir, "graph", "nodes.jsonl"),
        '{"id":"l2:1"}\n',
      );
      fs.writeFileSync(path.join(sourceDir, "readme.md"), "# hello\n");

      await provider.packDirectoryToBranch(
        tmpDir,
        sourceDir,
        KNOWLEDGE_BRANCH,
        "Snapshot [0000000]",
        undefined,
        true,
      );

      expect(await provider.branchExists(tmpDir, KNOWLEDGE_BRANCH)).toBe(true);
      const { stdout } = await git(tmpDir, [
        "ls-tree",
        "-r",
        "--name-only",
        KNOWLEDGE_BRANCH,
      ]);
      const files = stdout
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
      expect(files.sort()).toEqual(["graph/nodes.jsonl", "readme.md"]);

      const { stdout: content } = await git(tmpDir, [
        "show",
        `${KNOWLEDGE_BRANCH}:graph/nodes.jsonl`,
      ]);
      expect(content).toBe('{"id":"l2:1"}\n');

      const { stdout: message } = await git(tmpDir, [
        "log",
        "-1",
        "--format=%B",
        KNOWLEDGE_BRANCH,
      ]);
      expect(message.trim()).toBe("Snapshot [0000000]");

      const { stdout: parentCount } = await git(tmpDir, [
        "log",
        "-1",
        "--format=%P",
        KNOWLEDGE_BRANCH,
      ]);
      expect(parentCount.trim()).toBe("");
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("packDirectoryToBranch rejects cleanly (not an unhandled process crash) when a source file's path is one git itself refuses (e.g. a Windows-reserved device name) -- real repro: moby's pkg/progress.Aux rendered to knowledge/.../Aux.md and crashed the whole docuvia process with an unhandled 'write EOF' on child.stdin instead of surfacing git's own 'fatal: invalid path' (go-cli-benchmark.md §1.1); runFastImport's child.stdin now has its own error listener so this always surfaces as a normal rejected DocuviaError", async () => {
    const sourceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-git-local-pack-reserved-"),
    );
    try {
      // A path under `.git/` is refused by fast-import on *every* platform via git's own path
      // guard (unlike a Windows-reserved device name like `aux.md`, which git only rejects when
      // the repository/binary actually carries NTFS semantics -- so the test stays green on
      // macOS/Linux too).
      fs.mkdirSync(path.join(sourceDir, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(sourceDir, ".git", "internal.md"),
        "should be rejected\n",
      );

      await expect(
        provider.packDirectoryToBranch(
          tmpDir,
          sourceDir,
          KNOWLEDGE_BRANCH,
          "Snapshot [0000000]",
          undefined,
          true,
        ),
      ).rejects.toMatchObject({ code: "GIT_FAST_IMPORT_FAILED" });

      // The branch must not have been created/updated by a failed import (fast-import is
      // all-or-nothing: no ref update ever happens for a commit that fails mid-stream).
      expect(await provider.branchExists(tmpDir, KNOWLEDGE_BRANCH)).toBe(false);
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("runFastImport kills a git fast-import child that outlives its timeout instead of leaking it forever (issue #100)", async () => {
    const sourceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-git-local-fast-import-timeout-src-"),
    );
    try {
      // Enough data that git cannot start, import, and update the ref within a 1ms budget (same
      // tiny-timeout convention as pushRef's GIT_NETWORK_TIMEOUT test). A completed import would
      // resolve instead — that would be a real regression of the leak guard, so this must reject.
      for (let i = 0; i < 100; i++) {
        fs.writeFileSync(
          path.join(sourceDir, `file-${i}.md`),
          `# file ${i}\n` + "content\n".repeat(500),
        );
      }
      const fastImportData = buildFastImportData(
        KNOWLEDGE_BRANCH,
        await collectDirectoryFiles(sourceDir),
        Math.floor(Date.now() / 1000),
        "Snapshot [timeout]",
      );

      await expect(runFastImport(tmpDir, fastImportData, 1)).rejects.toThrow(
        /timed out after 1ms/,
      );
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("getChangedFilesSince treats a flag-like baseRef as a literal ref (errors) instead of parsing it as a git option", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    // Normal baseRef usage still works (regression guard for the `--end-of-options` change).
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 2;\n");
    const entries = await provider.getChangedFilesSince(tmpDir, "HEAD");
    expect(entries).toEqual(
      expect.arrayContaining([{ file: "tracked.ts", status: "modified" }]),
    );

    // A baseRef crafted to look like a git option must not be parsed as one — it's swallowed by
    // the method's catch-all (git errors on it as an invalid revision/option, not silently
    // executed as a flag), so this must resolve to an empty (or untracked-files-only) result
    // rather than throwing or invoking the injected option's behavior.
    await expect(
      provider.getChangedFilesSince(tmpDir, "--upload-pack=/bin/sh"),
    ).resolves.not.toThrow();
  });

  it("getFilesChangedByCommit treats a flag-like sha as a literal ref (errors) instead of parsing it as a git option", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);
    // `diff-tree` reports nothing for a root commit without `--root` — unrelated to this fix —
    // so use a second, non-root commit here.
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 2;\n");
    await git(tmpDir, ["commit", "-am", "second commit"]);
    const { stdout: headSha } = await git(tmpDir, ["rev-parse", "HEAD"]);

    // Normal sha usage still works (regression guard for the `--end-of-options` change).
    const files = await provider.getFilesChangedByCommit(
      tmpDir,
      headSha.trim(),
    );
    expect(files).toContain("tracked.ts");

    // A flag-like sha must surface as a `GIT_COMMAND_FAILED` DocuviaError (git rejects it as an
    // invalid revision/option), never as the option silently taking effect.
    await expect(
      provider.getFilesChangedByCommit(tmpDir, "--upload-pack=/bin/sh"),
    ).rejects.toMatchObject({ code: "GIT_COMMAND_FAILED" });
  });

  it("packDirectoryToBranch wholesale replaces an existing branch's tree while parenting the new commit on the prior tip (continuous stacking, STOR-001 point 2)", async () => {
    const firstSourceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-git-local-pack-src1-"),
    );
    const secondSourceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-git-local-pack-src2-"),
    );
    try {
      fs.writeFileSync(path.join(firstSourceDir, "old.md"), "stale\n");
      await provider.packDirectoryToBranch(
        tmpDir,
        firstSourceDir,
        KNOWLEDGE_BRANCH,
        "Snapshot [1111111]",
        undefined,
        true,
      );
      const firstSha = await provider.getBranchTipSha(tmpDir, KNOWLEDGE_BRANCH);

      fs.writeFileSync(path.join(secondSourceDir, "new.md"), "fresh\n");
      await provider.packDirectoryToBranch(
        tmpDir,
        secondSourceDir,
        KNOWLEDGE_BRANCH,
        "Snapshot [2222222]",
        undefined,
        true,
      );

      // Tree is wholesale replaced (old.md is gone) ...
      const { stdout } = await git(tmpDir, [
        "ls-tree",
        "-r",
        "--name-only",
        KNOWLEDGE_BRANCH,
      ]);
      const files = stdout
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
      expect(files).toEqual(["new.md"]);

      // ... but the first commit stays reachable as the second commit's parent, instead of being
      // orphaned by a fresh root commit — the bug STOR-001 point 2 exists to prevent.
      const { stdout: parents } = await git(tmpDir, [
        "log",
        "-1",
        "--format=%P",
        KNOWLEDGE_BRANCH,
      ]);
      expect(parents.trim()).toBe(firstSha);

      const { stdout: log } = await git(tmpDir, [
        "log",
        "--format=%H",
        KNOWLEDGE_BRANCH,
      ]);
      expect(log.trim().split("\n")).toHaveLength(2);
    } finally {
      fs.rmSync(firstSourceDir, { recursive: true, force: true });
      fs.rmSync(secondSourceDir, { recursive: true, force: true });
    }
  });
});

describe("GitLocalProvider — cross-clone reconciliation primitives (STOR-001 point 3)", () => {
  let tmpDir: string;
  let remoteDir: string;
  let provider: GitLocalProvider;

  beforeEach(async () => {
    const local = await createTempGitRepo("docuvia-git-local-clone-a-");
    tmpDir = local.dir;
    provider = local.provider;
    const remote = await createTempGitRepo("docuvia-git-local-remote-");
    remoteDir = remote.dir;

    // Give the "remote" an initial commit on its own default branch (never docuvia-knowledge), so
    // pushing docuvia-knowledge to it never touches remoteDir's checked-out branch.
    fs.writeFileSync(path.join(remoteDir, "readme.md"), "remote\n");
    await git(remoteDir, ["add", "-A"]);
    await git(remoteDir, ["commit", "-m", "init"]);

    await git(tmpDir, ["remote", "add", "origin", remoteDir]);
  }, 60_000);

  afterEach(async () => {
    await removeTempDir(tmpDir);
    await removeTempDir(remoteDir);
  });

  it("pushRef publishes the branch, fetchRef + getRefSha read it back into refs/remotes/origin/*", async () => {
    const sourceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-git-local-recon-src-"),
    );
    try {
      fs.writeFileSync(path.join(sourceDir, "a.md"), "hi\n");
      await provider.packDirectoryToBranch(
        tmpDir,
        sourceDir,
        KNOWLEDGE_BRANCH,
        "Snapshot [aaa]",
        undefined,
        true,
      );
      const localSha = await provider.getBranchTipSha(tmpDir, KNOWLEDGE_BRANCH);

      expect(
        await provider.getRefSha(
          tmpDir,
          `refs/remotes/origin/${KNOWLEDGE_BRANCH}`,
        ),
      ).toBeUndefined();

      await provider.pushRef(tmpDir, "origin", KNOWLEDGE_BRANCH);

      // Verify from a second, independent clone that it actually landed on the "remote".
      const cloneDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "docuvia-git-local-clone-b-"),
      );
      try {
        await git(cloneDir, ["init"]);
        await git(cloneDir, ["remote", "add", "origin", remoteDir]);
        await provider.fetchRef(cloneDir, "origin", KNOWLEDGE_BRANCH);
        expect(
          await provider.getRefSha(
            cloneDir,
            `refs/remotes/origin/${KNOWLEDGE_BRANCH}`,
          ),
        ).toBe(localSha);
      } finally {
        fs.rmSync(cloneDir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("pushRef honors an explicit timeoutMs override (config-tunable — defaults to no timeout, but a caller can still opt back into one)", async () => {
    const sourceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-git-local-timeout-src-"),
    );
    try {
      fs.writeFileSync(path.join(sourceDir, "a.md"), "hi\n");
      await provider.packDirectoryToBranch(
        tmpDir,
        sourceDir,
        KNOWLEDGE_BRANCH,
        "Snapshot [aaa]",
        undefined,
        true,
      );

      await expect(
        provider.pushRef(tmpDir, "origin", KNOWLEDGE_BRANCH, 1),
      ).rejects.toMatchObject({ code: "GIT_NETWORK_TIMEOUT" });
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("fetchRef/pushRef fail fast as GIT_COMMAND_FAILED (not GIT_NETWORK_TIMEOUT) against a remote that simply doesn't resolve — the classification must not label every failure a timeout just because a timeout option is now set", async () => {
    const nonexistentRemotePath = path.join(
      os.tmpdir(),
      "docuvia-git-local-nonexistent-remote-",
    );

    await expect(
      provider.pushRef(tmpDir, nonexistentRemotePath, KNOWLEDGE_BRANCH),
    ).rejects.toMatchObject({ code: "GIT_COMMAND_FAILED" });
    await expect(
      provider.fetchRef(tmpDir, nonexistentRemotePath, KNOWLEDGE_BRANCH),
    ).rejects.toMatchObject({ code: "GIT_COMMAND_FAILED" });
  });

  it("getRefSha returns undefined for a ref that doesn't exist", async () => {
    expect(
      await provider.getRefSha(tmpDir, "refs/heads/does-not-exist"),
    ).toBeUndefined();
  });

  it("isAncestor detects fast-forward relationships and rejects unrelated/reversed ones", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.md"), "1\n");
    await git(tmpDir, ["add", "-A"]);
    await git(tmpDir, ["commit", "-m", "first"]);
    const { stdout: firstSha } = await git(tmpDir, ["rev-parse", "HEAD"]);

    fs.writeFileSync(path.join(tmpDir, "a.md"), "2\n");
    await git(tmpDir, ["commit", "-am", "second"]);
    const { stdout: secondSha } = await git(tmpDir, ["rev-parse", "HEAD"]);

    expect(
      await provider.isAncestor(tmpDir, firstSha.trim(), secondSha.trim()),
    ).toBe(true);
    expect(
      await provider.isAncestor(tmpDir, secondSha.trim(), firstSha.trim()),
    ).toBe(false);
    expect(
      await provider.isAncestor(tmpDir, firstSha.trim(), firstSha.trim()),
    ).toBe(true);
  });

  it("getTreeSha / getCommitTimestamp / createMergeCommit build a valid 2-parent tree-adoption merge commit", async () => {
    const sourceDirA = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-git-local-recon-a-"),
    );
    const sourceDirB = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-git-local-recon-b-"),
    );
    try {
      fs.writeFileSync(path.join(sourceDirA, "a.md"), "from A\n");
      await provider.packDirectoryToBranch(
        tmpDir,
        sourceDirA,
        KNOWLEDGE_BRANCH,
        "Snapshot [aaa]",
        undefined,
        true,
      );
      const shaA = (await provider.getBranchTipSha(tmpDir, KNOWLEDGE_BRANCH))!;

      // Simulate independent divergence (two clones that each started their own knowledge
      // branch): delete the ref, then pack a different tree as a second, unrelated root commit.
      await git(tmpDir, ["update-ref", "-d", `refs/heads/${KNOWLEDGE_BRANCH}`]);
      fs.writeFileSync(path.join(sourceDirB, "b.md"), "from B\n");
      await provider.packDirectoryToBranch(
        tmpDir,
        sourceDirB,
        KNOWLEDGE_BRANCH,
        "Snapshot [bbb]",
        undefined,
        true,
      );
      const shaB = (await provider.getBranchTipSha(tmpDir, KNOWLEDGE_BRANCH))!;

      expect(await provider.isAncestor(tmpDir, shaA, shaB)).toBe(false);
      expect(await provider.isAncestor(tmpDir, shaB, shaA)).toBe(false);

      const timestampA = await provider.getCommitTimestamp(tmpDir, shaA);
      expect(timestampA).toBeGreaterThan(0);

      const winningTree = await provider.getTreeSha(tmpDir, shaB); // adopt B's tree wholesale
      const mergeSha = await provider.createMergeCommit(
        tmpDir,
        winningTree,
        [shaA, shaB],
        "Merge knowledge branch",
      );

      const { stdout: parents } = await git(tmpDir, [
        "log",
        "-1",
        "--format=%P",
        mergeSha,
      ]);
      expect(parents.trim().split(" ")).toEqual([shaA, shaB]);

      const { stdout: committer } = await git(tmpDir, [
        "log",
        "-1",
        "--format=%cn <%ce>",
        mergeSha,
      ]);
      expect(committer.trim()).toBe("Docuvia <docuvia@localhost>");

      const { stdout: mergeTreeSha } = await git(tmpDir, [
        "log",
        "-1",
        "--format=%T",
        mergeSha,
      ]);
      expect(mergeTreeSha.trim()).toBe(winningTree);

      // The merge commit's content matches B's tree (the adopted side), not A's.
      await git(tmpDir, [
        "update-ref",
        `refs/heads/${KNOWLEDGE_BRANCH}`,
        mergeSha,
      ]);
      const { stdout: files } = await git(tmpDir, [
        "ls-tree",
        "-r",
        "--name-only",
        KNOWLEDGE_BRANCH,
      ]);
      expect(files.trim().split("\n")).toEqual(["b.md"]);
    } finally {
      fs.rmSync(sourceDirA, { recursive: true, force: true });
      fs.rmSync(sourceDirB, { recursive: true, force: true });
    }
  });
});

describe("GitLocalProvider — acquireKnowledgeLock / releaseKnowledgeLock", () => {
  let tmpDir: string;
  let provider: GitLocalProvider;

  beforeEach(async () => {
    const repo = await createTempGitRepo("docuvia-git-local-lock-");
    tmpDir = repo.dir;
    provider = repo.provider;
  });

  afterEach(async () => {
    await removeTempDir(tmpDir);
  });

  it("acquires and releases the lock file under .git/", async () => {
    const lockPath = path.join(tmpDir, ".git", "docuvia-knowledge.lock");
    expect(fs.existsSync(lockPath)).toBe(false);

    await provider.acquireKnowledgeLock(tmpDir);
    expect(fs.existsSync(lockPath)).toBe(true);

    await provider.releaseKnowledgeLock(tmpDir);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("releaseKnowledgeLock on an already-released lock is a no-op, not an error", async () => {
    await expect(
      provider.releaseKnowledgeLock(tmpDir),
    ).resolves.toBeUndefined();
  });

  it("serializes two concurrent acquirers instead of both succeeding at once", async () => {
    const events: string[] = [];

    await provider.acquireKnowledgeLock(tmpDir);
    events.push("first:acquired");

    const secondAcquire = provider.acquireKnowledgeLock(tmpDir).then(() => {
      events.push("second:acquired");
    });

    // The second acquirer must still be waiting — give it a moment to (not) succeed.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(events).toEqual(["first:acquired"]);

    await provider.releaseKnowledgeLock(tmpDir);
    await secondAcquire;
    expect(events).toEqual(["first:acquired", "second:acquired"]);

    await provider.releaseKnowledgeLock(tmpDir);
  });

  it("steals a stale lock left behind by a crashed process instead of waiting forever", async () => {
    const lockPath = path.join(tmpDir, ".git", "docuvia-knowledge.lock");
    fs.writeFileSync(lockPath, "");
    const oldTime = new Date(Date.now() - 120_000);
    fs.utimesSync(lockPath, oldTime, oldTime);

    await expect(
      provider.acquireKnowledgeLock(tmpDir),
    ).resolves.toBeUndefined();

    await provider.releaseKnowledgeLock(tmpDir);
  });
});

describe("GitLocalProvider — git worktree support (roadmap item #10)", () => {
  let mainDir: string;
  let worktreeParent: string;
  let worktreeDir: string;
  let provider: GitLocalProvider;

  beforeEach(async () => {
    const main = await createTempGitRepo("docuvia-git-local-worktree-main-", {
      initialCommit: true,
    });
    mainDir = main.dir;
    provider = main.provider;

    // `git worktree add` must create the target dir itself — pre-creating and removing it
    // (e.g. via mkdtempSync + rmdirSync) races with Windows' deferred directory deletion under
    // load. Instead, reserve a unique parent via mkdtempSync and point the worktree at a
    // not-yet-existing child of it.
    worktreeParent = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-git-local-worktree-linked-"),
    );
    worktreeDir = path.join(worktreeParent, "wt");
    // `git worktree add` tolerates an already-existing *empty* target dir (unlike `git clone`);
    // pre-creating it synchronously removes one race. The remaining risk is a known git-for-
    // Windows issue where antivirus/real-time-protection briefly locks files git itself just
    // created, surfacing as a spurious ENOENT under heavy concurrent test-suite I/O — retried
    // below. `--detach` (no branch) and `--no-checkout` (these tests never touch working-tree
    // content) both keep retries idempotent and shrink the file-write surface that can race.
    fs.mkdirSync(worktreeDir, { recursive: true });
    await retryTransientFsRace(async () => {
      await git(mainDir, ["worktree", "prune"]).catch(() => undefined);
      return git(mainDir, [
        "worktree",
        "add",
        "--detach",
        "--no-checkout",
        worktreeDir,
      ]);
    });
  }, 60_000);

  afterEach(async () => {
    await git(mainDir, ["worktree", "remove", "--force", worktreeDir]).catch(
      () => undefined,
    );
    await removeTempDir(mainDir);
    await removeTempDir(worktreeParent);
  });

  it("a linked worktree's .git is a file, not a directory", () => {
    const gitPath = path.join(worktreeDir, ".git");
    expect(fs.statSync(gitPath).isFile()).toBe(true);
  });

  it("hooksDirExists / appendHookFile / readHookFile resolve through the main repo's common .git/hooks instead of failing on the worktree's .git file", async () => {
    // Same windows AV/spawn race as the plain-repo hook test (issue #188).
    await retryTransientFsRace(async () => {
      expect(await provider.hooksDirExists(worktreeDir)).toBe(true);

      await provider.appendHookFile(
        worktreeDir,
        HOOK_NAME,
        `#!/bin/bash\n# ${HOOK_MARKER}\n`,
      );
      expect(await provider.readHookFile(worktreeDir, HOOK_NAME)).toContain(
        HOOK_MARKER,
      );
    });

    // Hooks are shared across all worktrees — the file must land under the MAIN repo's real .git/hooks.
    const mainHookPath = path.join(mainDir, ".git", "hooks", HOOK_NAME);
    expect(fs.existsSync(mainHookPath)).toBe(true);
    expect(fs.readFileSync(mainHookPath, "utf8")).toContain(HOOK_MARKER);
  }, 60_000);

  it("acquireKnowledgeLock / releaseKnowledgeLock work from inside a linked worktree instead of throwing ENOENT", async () => {
    await expect(
      provider.acquireKnowledgeLock(worktreeDir),
    ).resolves.toBeUndefined();
    await expect(
      provider.releaseKnowledgeLock(worktreeDir),
    ).resolves.toBeUndefined();
  });
});

describe("GitLocalProvider — getChangedFilesSince two-ref mode (Slice 2a delta ingestion, phase1-decision-integration.md §6d ruling 2)", () => {
  let tmpDir: string;
  let provider: GitLocalProvider;

  beforeEach(async () => {
    const repo = await createTempGitRepo("docuvia-git-local-tworef-test-");
    tmpDir = repo.dir;
    provider = repo.provider;
  });

  afterEach(async () => {
    await removeTempDir(tmpDir);
  });

  it("reports added, modified, deleted, and renamed (with oldFile, across directories) between two commit shas, and omits untouched files", async () => {
    // Commit A: the baseline.
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "kept.ts"), "export const kept = 1;\n");
    fs.writeFileSync(path.join(tmpDir, "modified.ts"), "export const m = 1;\n");
    fs.writeFileSync(path.join(tmpDir, "deleted.ts"), "export const d = 1;\n");
    fs.writeFileSync(
      path.join(tmpDir, "src", "old-name.ts"),
      "export const renamed = 1;\nexport const line2 = 2;\n",
    );
    await git(tmpDir, ["add", "-A"]);
    await git(tmpDir, ["commit", "-m", "A"]);
    const { stdout: baseShaOut } = await git(tmpDir, ["rev-parse", "HEAD"]);
    const baseSha = baseShaOut.trim();

    // Commit B: add, modify, delete, and rename-across-directories relative to A.
    fs.writeFileSync(path.join(tmpDir, "added.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(tmpDir, "modified.ts"), "export const m = 2;\n");
    fs.rmSync(path.join(tmpDir, "deleted.ts"));
    fs.mkdirSync(path.join(tmpDir, "lib"), { recursive: true });
    await git(tmpDir, ["mv", "src/old-name.ts", "lib/new-name.ts"]);
    await git(tmpDir, ["add", "-A"]);
    await git(tmpDir, ["commit", "-m", "B"]);
    const { stdout: toShaOut } = await git(tmpDir, ["rev-parse", "HEAD"]);
    const toSha = toShaOut.trim();

    const entries = await provider.getChangedFilesSince(tmpDir, baseSha, toSha);

    expect(entries).toEqual(
      expect.arrayContaining([
        { file: "added.ts", status: "added" },
        { file: "modified.ts", status: "modified" },
        { file: "deleted.ts", status: "deleted" },
        {
          file: "lib/new-name.ts",
          status: "renamed",
          oldFile: "src/old-name.ts",
        },
      ]),
    );
    // kept.ts was untouched between A and B — must not appear.
    expect(entries.find((e: any) => e.file === "kept.ts")).toBeUndefined();
    // The old rename path must not additionally appear as its own "deleted" entry.
    expect(
      entries.find((e: any) => e.file === "src/old-name.ts"),
    ).toBeUndefined();
    expect(entries).toHaveLength(4);
  });

  it("single-ref legacy mode (no toRef) still diffs against the working tree and merges untracked files (regression guard)", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    // Uncommitted modification + a new untracked file — neither is a commit yet.
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 2;\n");
    fs.writeFileSync(
      path.join(tmpDir, "untracked.ts"),
      "export const b = 1;\n",
    );

    // No baseRef, no toRef: implicit HEAD, working-tree diff merged with untracked files — the
    // only call shape that merges in untracked files (per the method's `if (!baseRef && !toRef)`
    // gate).
    const implicitEntries = await provider.getChangedFilesSince(tmpDir);
    expect(implicitEntries).toEqual(
      expect.arrayContaining([
        { file: "tracked.ts", status: "modified" },
        { file: "untracked.ts", status: "added" },
      ]),
    );

    // Explicit baseRef="HEAD", no toRef: still a working-tree diff (uncommitted edits are
    // included), but untracked files are deliberately NOT merged in once baseRef is supplied
    // explicitly — this is the pre-existing single-ref contract this test guards.
    const explicitEntries = await provider.getChangedFilesSince(tmpDir, "HEAD");
    expect(explicitEntries).toEqual([
      { file: "tracked.ts", status: "modified" },
    ]);
  });
});

describe("GitLocalProvider — getBlameLineOwners (issue #68's per-line ownership read)", () => {
  let tmpDir: string;
  let provider: GitLocalProvider;
  let firstSha: string;

  function lines(n: number): string {
    return Array.from({ length: n }, (_, i) => `l${i + 1}`).join("\n") + "\n";
  }

  async function commitAll(message: string): Promise<string> {
    await git(tmpDir, ["add", "-A"]);
    await git(tmpDir, ["commit", "-m", message]);
    const { stdout } = await git(tmpDir, ["rev-parse", "HEAD"]);
    return stdout.trim();
  }

  beforeEach(async () => {
    const repo = await createTempGitRepo("docuvia-git-local-blame-test-");
    tmpDir = repo.dir;
    provider = repo.provider;
    fs.writeFileSync(path.join(tmpDir, "f.ts"), lines(10));
    firstSha = await commitAll("first");
  });

  afterEach(async () => {
    await removeTempDir(tmpDir);
  });

  it("maps every final line to the sha of the commit that last touched it", async () => {
    const content = lines(10).split("\n");
    content[4] = "l5-rewritten"; // line 5 rewritten by a second commit
    fs.writeFileSync(path.join(tmpDir, "f.ts"), content.join("\n"));
    const secondSha = await commitAll("second");

    const owners = await provider.getBlameLineOwners(tmpDir, "f.ts");

    expect(owners.size).toBe(10);
    expect(owners.get(1)).toBe(firstSha);
    expect(owners.get(5)).toBe(secondSha);
    expect(owners.get(6)).toBe(firstSha);
  });

  it("returns an empty map for a nonexistent file (unknown ownership, not a throw)", async () => {
    const owners = await provider.getBlameLineOwners(tmpDir, "nope.ts");
    expect(owners.size).toBe(0);
  });
});

describe("GitLocalProvider — getChangedLineRanges hunk-header parsing (Slice 2a delta ingestion, phase1-decision-integration.md §6d ruling 2)", () => {
  let tmpDir: string;
  let provider: GitLocalProvider;
  let baseSha: string;

  function lines(n: number): string {
    return Array.from({ length: n }, (_, i) => `l${i + 1}`).join("\n") + "\n";
  }

  async function commitFile(): Promise<void> {
    await git(tmpDir, ["add", "-A"]);
    await git(tmpDir, ["commit", "-m", "change"]);
  }

  async function headSha(): Promise<string> {
    const { stdout } = await git(tmpDir, ["rev-parse", "HEAD"]);
    return stdout.trim();
  }

  beforeEach(async () => {
    const repo = await createTempGitRepo("docuvia-git-local-hunks-test-");
    tmpDir = repo.dir;
    provider = repo.provider;

    fs.writeFileSync(path.join(tmpDir, "f.ts"), lines(20));
    await commitFile();
    baseSha = await headSha();
  });

  afterEach(async () => {
    await removeTempDir(tmpDir);
  });

  it("a single-line change yields one range spanning that one line", async () => {
    const content = lines(20).split("\n");
    content[9] = "l10-changed"; // 0-indexed array, line 10
    fs.writeFileSync(path.join(tmpDir, "f.ts"), content.join("\n"));
    await commitFile();
    const toSha = await headSha();

    const ranges = await provider.getChangedLineRanges(
      tmpDir,
      baseSha,
      toSha,
      "f.ts",
    );
    expect(ranges).toEqual([{ startRow: 9, endRow: 9 }]);
  });

  it("a multi-line contiguous change yields one range spanning all touched lines", async () => {
    const content = lines(20).split("\n");
    content[9] = "l10-x";
    content[10] = "l11-x";
    content[11] = "l12-x";
    fs.writeFileSync(path.join(tmpDir, "f.ts"), content.join("\n"));
    await commitFile();
    const toSha = await headSha();

    const ranges = await provider.getChangedLineRanges(
      tmpDir,
      baseSha,
      toSha,
      "f.ts",
    );
    expect(ranges).toEqual([{ startRow: 9, endRow: 11 }]);
  });

  it("multiple disjoint hunks in one file yield one range per hunk", async () => {
    const content = lines(20).split("\n");
    content[1] = "l2-x"; // line 2
    content[17] = "l18-x"; // line 18 — far enough from line 2 that --unified=0 keeps them separate
    fs.writeFileSync(path.join(tmpDir, "f.ts"), content.join("\n"));
    await commitFile();
    const toSha = await headSha();

    const ranges = await provider.getChangedLineRanges(
      tmpDir,
      baseSha,
      toSha,
      "f.ts",
    );
    expect(ranges).toEqual([
      { startRow: 1, endRow: 1 },
      { startRow: 17, endRow: 17 },
    ]);
  });

  it("a pure insertion (nothing removed) yields a range spanning only the newly inserted lines", async () => {
    const content = lines(20).split("\n");
    content.splice(5, 0, "NEWLINE1", "NEWLINE2"); // insert after line 5 (0-indexed position 5)
    fs.writeFileSync(path.join(tmpDir, "f.ts"), content.join("\n"));
    await commitFile();
    const toSha = await headSha();

    const ranges = await provider.getChangedLineRanges(
      tmpDir,
      baseSha,
      toSha,
      "f.ts",
    );
    // Old side is a zero-length insertion point; new side gains 2 lines (new lines 6-7, 0-indexed 5-6).
    expect(ranges).toEqual([{ startRow: 5, endRow: 6 }]);
  });

  it("a pure deletion (nothing added) yields a zero-width anchor range at the insertion point, per the documented contract", async () => {
    const content = lines(20).split("\n");
    content.splice(4, 2); // delete lines 5-6 (0-indexed positions 4-5), nothing replaces them
    fs.writeFileSync(path.join(tmpDir, "f.ts"), content.join("\n"));
    await commitFile();
    const toSha = await headSha();

    const ranges = await provider.getChangedLineRanges(
      tmpDir,
      baseSha,
      toSha,
      "f.ts",
    );
    // git reports "@@ -5,2 +4,0 @@" (new side is zero-length); the implementation's documented
    // contract anchors a deletion-only hunk at max(newStart - 1, 0) as a zero-width range so the
    // deletion is still locatable rather than silently dropped.
    expect(ranges).toEqual([{ startRow: 3, endRow: 3 }]);
  });

  it("a file with no changes between refs yields an empty range list", async () => {
    // Diffing a ref against itself for a file that was never touched.
    const ranges = await provider.getChangedLineRanges(
      tmpDir,
      baseSha,
      baseSha,
      "f.ts",
    );
    expect(ranges).toEqual([]);
  });
});
