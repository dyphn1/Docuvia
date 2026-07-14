import path from "path";
import { pathToFileURL } from "url";
import type {
  IGitProvider,
  IProjectsRepo,
  ProjectRow,
} from "@workspace/contracts";

/**
 * Phase 2: seeds the single project row. One project row per local.db — only seeds on first
 * run so re-running `init` stays idempotent. The `getFirst()` check below is only a fast path to
 * skip the `git.getRemoteUrl()` shell-out once a project row already exists; the actual
 * correctness guarantee against two `init` processes racing a fresh workspace comes from
 * `getOrInsert()`'s atomic check-and-insert (see its doc comment), which is why this always
 * calls `getOrInsert()` — never the non-atomic `insert()` — even after the fast path misses.
 * `vcs_type` is left to the schema's `DEFAULT 'git'`.
 */
export async function seedProjectRow(
  projectsRepo: IProjectsRepo,
  git: IGitProvider,
  workspaceRoot: string,
): Promise<ProjectRow> {
  const existing = projectsRepo.getFirst();
  if (existing) return existing;

  const remoteUrl = await git.getRemoteUrl(workspaceRoot);
  const repoUrl = remoteUrl ?? pathToFileURL(path.resolve(workspaceRoot)).href;

  return projectsRepo.getOrInsert({
    name: path.basename(workspaceRoot),
    repoUrl,
  });
}
