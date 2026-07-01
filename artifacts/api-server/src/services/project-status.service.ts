import { db, commitsTable, projectsTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export interface IngestStatus {
  projectId: number;
  vcsType: string | null;
  lastGitIngestedAt: string | null;
  lastSvnRevision: number | null;
  pendingCommits: number;
}

export class ProjectStatusService {
  async getStatus(
    projectId: number,
    project: typeof projectsTable.$inferSelect
  ): Promise<IngestStatus> {
    const [{ pendingCount }] = await db
      .select({ pendingCount: sql<number>`count(*)::int` })
      .from(commitsTable)
      .where(and(eq(commitsTable.projectId, projectId), isNull(commitsTable.processedAt)));

    return {
      projectId: project.id,
      vcsType: project.vcsType,
      lastGitIngestedAt: project.lastGitIngestedAt?.toISOString() ?? null,
      lastSvnRevision: project.lastSvnRevision ?? null,
      pendingCommits: Number(pendingCount),
    };
  }
}
