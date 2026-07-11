import path from "path";
import { pathToFileURL } from "url";
import type { ProjectRow } from "@workspace/schema";
import type { ProjectsRepo } from "../../memory/repos/projects-repo.js";
import { IWorkspaceGitService } from "../../interfaces/workspace-git.interfaces.js";

/**
 * Phase 2 of `InitCommand.execute()`: the idempotency-check-and-insert logic ported from old
 * `InitService.init()`'s step 3 (minus schema/DDL execution, which `GraphStore.open()` already
 * guarantees happened before this runs). One project row per local.db (see
 * `GitConstants.DEFAULT_LOCAL_PROJECT_ID`) — only seeds on first run so re-running `init` stays
 * idempotent. `vcs_type` is left to the schema's `DEFAULT 'git'` (old `InitService` never set
 * it explicitly either — `ProjectsRepo.insert()` intentionally has no `vcsType` param).
 */
export async function seedProjectRow(
  projectsRepo: ProjectsRepo,
  git: IWorkspaceGitService,
  workspaceRoot: string
): Promise<ProjectRow> {
  const existing = projectsRepo.getFirst();
  if (existing) return existing;

  const remoteUrl = await git.getRemoteUrl(workspaceRoot);
  const repoUrl = remoteUrl ?? pathToFileURL(path.resolve(workspaceRoot)).href;

  return projectsRepo.insert({ name: path.basename(workspaceRoot), repoUrl });
}
