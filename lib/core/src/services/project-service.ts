import { db } from "@workspace/db";
import { projectsTable, l2NodesTable, l3NodesTable } from "@workspace/db/schema";
import { sql, count, eq } from "drizzle-orm";

export class ProjectService {
  public static async listProjects() {
    const [projects, l2Counts, l3Counts] = await Promise.all([
      db
        .select()
        .from(projectsTable)
        .orderBy(sql`${projectsTable.name} asc`),
      db
        .select({
          projectId: l2NodesTable.projectId,
          count: count(),
        })
        .from(l2NodesTable)
        .groupBy(l2NodesTable.projectId),
      db
        .select({
          projectId: l2NodesTable.projectId,
          count: count(),
        })
        .from(l3NodesTable)
        .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
        .groupBy(l2NodesTable.projectId),
    ]);

    const l2CountByProject = new Map(l2Counts.map((row) => [row.projectId, row.count]));
    const l3CountByProject = new Map(l3Counts.map((row) => [row.projectId, row.count]));

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      repoUrl: p.repoUrl,
      l2Count: l2CountByProject.get(p.id) ?? 0,
      l3Count: l3CountByProject.get(p.id) ?? 0,
    }));
  }
}
