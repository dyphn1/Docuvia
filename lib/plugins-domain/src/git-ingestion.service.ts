import { db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  LocalGitClient,
  processIngestion,
  GitCommitItem,
  IGitIngestionService,
} from "@workspace/core";

export interface IngestGitOptions {
  repoUrl: string;
  branch: string;
  limit: number;
  mode: "full" | "incremental";
}

export interface IngestionResult {
  ingested: number;
  skipped: number;
  errors: string[];
  totalFetched?: number;
}

// `git show` is spawned per commit to fetch its diff; cap how many run concurrently
// so a large commit range doesn't fork hundreds of subprocesses at once.
const DIFF_FETCH_CONCURRENCY = 10;

export class GitIngestionService implements IGitIngestionService {
  async ingestGit(
    project: typeof projectsTable.$inferSelect,
    options: IngestGitOptions
  ): Promise<IngestionResult> {
    const client = new LocalGitClient(options.repoUrl);
    try {
      await client.clone(options.branch);

      const since =
        options.mode === "incremental" && project.lastGitIngestedAt
          ? project.lastGitIngestedAt
          : undefined;
      const commits = await client.getCommits(options.limit, since);

      const gitItems: GitCommitItem[] = [];
      for (let i = 0; i < commits.length; i += DIFF_FETCH_CONCURRENCY) {
        const batch = commits.slice(i, i + DIFF_FETCH_CONCURRENCY);
        const batchWithDiffs = await Promise.all(
          batch.map(async (c) => ({ ...c, diff: await client.getDiff(c.sha) }))
        );
        gitItems.push(...batchWithDiffs);
      }

      let newestCommitDate: Date | null = null;
      for (const c of commits) {
        const commitDate = new Date(c.date ?? "");
        if (!isNaN(commitDate.getTime()) && (!newestCommitDate || commitDate > newestCommitDate)) {
          newestCommitDate = commitDate;
        }
      }

      let ingested = 0;
      let skipped = 0;
      let errors: string[] = [];
      await db.transaction(async (tx) => {
        const res = await processIngestion(
          {
            type: "git",
            projectId: project.id,
            projectName: project.name,
            items: gitItems,
          },
          tx
        );
        ingested = res.ingested;
        skipped = res.skipped;
        errors = res.errors;

        if (options.mode === "incremental" && newestCommitDate) {
          await tx
            .update(projectsTable)
            .set({ lastGitIngestedAt: newestCommitDate })
            .where(eq(projectsTable.id, project.id));
        }
      });

      return {
        ingested,
        skipped,
        totalFetched: gitItems.length,
        errors,
      };
    } finally {
      await client.cleanup();
    }
  }
}
