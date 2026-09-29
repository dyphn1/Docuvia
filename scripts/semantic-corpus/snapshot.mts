/** C-01 snapshot materialization and byte-verified hashing (#506). The source checkout is only
 *  read (`git archive`); the snapshot lives in a private throwaway repository. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  isSnapshotPath,
  snapshotHash,
} from "../../lib/core/src/semantic/collection/semantic-snapshot-hash.js";

const FIXED_GIT_ENV = {
  GIT_AUTHOR_NAME: "docuvia-corpus",
  GIT_AUTHOR_EMAIL: "corpus@docuvia.invalid",
  GIT_COMMITTER_NAME: "docuvia-corpus",
  GIT_COMMITTER_EMAIL: "corpus@docuvia.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};
const MAX_BUFFER = 1024 * 1024 * 512;

export function git(cwd: string, args: string[], input?: Buffer): string {
  return execFileSync("git", args, {
    cwd,
    input,
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, ...FIXED_GIT_ENV },
  }).toString("utf8");
}

export interface SourceRevision {
  readonly revision: string;
  readonly committedAt: string;
  readonly rootCommits: string[];
}

export function describeRevision(
  sourceDir: string,
  revision: string,
): SourceRevision {
  const [full, committedAt] = git(sourceDir, [
    "log",
    "-1",
    "--format=%H %cI",
    revision,
  ])
    .trim()
    .split(" ");
  const rootCommits = git(sourceDir, ["rev-list", "--max-parents=0", full])
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  return { revision: full, committedAt, rootCommits };
}

/** True when `earlier` is an ancestor of `later` and committed strictly before it. */
export function verifyTemporalOrder(
  sourceDir: string,
  earlier: SourceRevision,
  later: SourceRevision,
): boolean {
  try {
    git(sourceDir, [
      "merge-base",
      "--is-ancestor",
      earlier.revision,
      later.revision,
    ]);
  } catch {
    return false;
  }
  return Date.parse(earlier.committedAt) < Date.parse(later.committedAt);
}

export function materializeSnapshot(
  sourceDir: string,
  revision: string,
  subtree: string | null,
  dest: string,
): void {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const archive = execFileSync(
    "git",
    ["archive", "--format=tar", revision, ...(subtree ? [subtree] : [])],
    { cwd: sourceDir, maxBuffer: MAX_BUFFER * 4 },
  );
  const extractArgs = subtree
    ? ["-x", "--strip-components", String(subtree.split("/").length)]
    : ["-x"];
  execFileSync("tar", extractArgs, {
    cwd: dest,
    input: archive,
    maxBuffer: MAX_BUFFER,
  });
  git(dest, ["init", "-q", "-b", "main"]);
  git(dest, ["add", "-A"]);
  git(dest, ["commit", "-q", "--no-verify", "-m", `snapshot ${revision}`]);
}

export interface SnapshotFiles {
  readonly hash: string;
  readonly files: ReadonlyMap<string, string>;
}

/** Recomputes the snapshot hash from the bytes currently on disk (never from a declaration). */
export function hashSnapshot(dir: string): SnapshotFiles {
  const tracked = git(dir, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const files = new Map<string, string>();
  for (const file of tracked.filter(isSnapshotPath).sort()) {
    const bytes = readFileSync(path.join(dir, file));
    files.set(file, createHash("sha256").update(bytes).digest("hex"));
  }
  const entries = [...files].map(([p, sha256]) => ({ path: p, sha256 }));
  return { hash: snapshotHash(entries), files };
}

/** Dirty state is part of the identity: a snapshot must be clean when hashed. */
export function assertClean(dir: string): void {
  const status = git(dir, [
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]).trim();
  if (status) throw new Error(`Snapshot ${dir} is dirty:\n${status}`);
}
