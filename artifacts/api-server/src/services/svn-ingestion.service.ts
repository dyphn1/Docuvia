import { db, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSvnLog, getSvnDiff, processIngestion, SvnCommitItem } from "@workspace/core";

export interface IngestSvnOptions {
  svnUrl: string;
  username?: string;
  password?: string;
  startRevision?: number;
  endRevision?: number | "HEAD";
  mode: "full" | "incremental";
}

export interface IngestionResult {
  ingested: number;
  skipped: number;
  errors: string[];
  totalFetched?: number;
}

export class SvnIngestionService {
  async ingestSvn(
    project: typeof projectsTable.$inferSelect,
    options: IngestSvnOptions
  ): Promise<IngestionResult> {
    let startRevision = options.startRevision ?? 1;
    const endRevision = options.endRevision ?? "HEAD";

    if (options.mode === "incremental" && project.lastSvnRevision != null) {
      startRevision = project.lastSvnRevision + 1;
    }

    let maxRevisionIngested = project.lastSvnRevision ?? 0;
    let totalIngested = 0;
    let totalSkipped = 0;
    const svnErrors: string[] = [];
    const ingestErrors: string[] = [];

    const logGenerator = getSvnLog(
      options.svnUrl,
      startRevision,
      endRevision,
      options.username,
      options.password
    );
    let batch: SvnCommitItem[] = [];

    const flushBatch = async () => {
      if (batch.length === 0) return;
      await db.transaction(async (tx) => {
        const { ingested, skipped, errors } = await processIngestion(
          {
            type: "svn",
            projectId: project.id,
            projectName: project.name,
            items: batch,
          },
          tx
        );
        totalIngested += ingested;
        totalSkipped += skipped;
        ingestErrors.push(...errors);
      });
      batch = [];
    };

    for await (const rev of logGenerator) {
      let diff = "";
      try {
        diff = await getSvnDiff(options.svnUrl, rev.revision, options.username, options.password);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        svnErrors.push(`r${rev.revision}: ${msg}`);
      }

      batch.push({
        revision: rev.revision,
        message: rev.message,
        author: rev.author,
        diff,
      });

      if (rev.revision > maxRevisionIngested) maxRevisionIngested = rev.revision;

      if (batch.length >= 50) {
        await flushBatch();
      }
    }

    await flushBatch();

    if (options.mode === "incremental" && maxRevisionIngested > (project.lastSvnRevision ?? 0)) {
      await db.transaction(async (tx) => {
        await tx
          .update(projectsTable)
          .set({ lastSvnRevision: maxRevisionIngested })
          .where(eq(projectsTable.id, project.id));
      });
    }

    return {
      ingested: totalIngested,
      skipped: totalSkipped,
      errors: [...svnErrors, ...ingestErrors],
    };
  }
}
