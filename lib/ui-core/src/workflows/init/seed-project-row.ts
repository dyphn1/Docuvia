import path from "path";
import { pathToFileURL } from "url";
import type {
  IGitProvider,
  IProjectsRepo,
  ProjectRow,
} from "@workspace/contracts";

/**
 * Phase 2: the idempotency-check-and-insert logic. One project row per local.db — only seeds
 * on first run so re-running `init` stays idempotent. `vcs_type` is left to the schema's
 * `DEFAULT 'git'`.
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

  return projectsRepo.insert({ name: path.basename(workspaceRoot), repoUrl });
}
