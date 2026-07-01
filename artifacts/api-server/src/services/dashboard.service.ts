import { db } from "@workspace/db";
import {
  projectsTable,
  l1TagsTable,
  l2NodesTable,
  l3NodesTable,
  reviewTasksTable,
  activityLogTable,
  projectsTable as proj,
} from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";

export class DashboardService {
  async getDashboardStats() {
    const [projectsCount] = await db.select({ count: count() }).from(projectsTable);
    const [l1Count] = await db.select({ count: count() }).from(l1TagsTable);
    const [l2Count] = await db.select({ count: count() }).from(l2NodesTable);
    const [l3Count] = await db.select({ count: count() }).from(l3NodesTable);
    const [pendingCount] = await db
      .select({ count: count() })
      .from(reviewTasksTable)
      .where(eq(reviewTasksTable.status, "pending"));

    const activityRows = await db
      .select()
      .from(activityLogTable)
      .orderBy(sql`${activityLogTable.createdAt} desc`)
      .limit(10);

    const recentActivity = await Promise.all(
      activityRows.map(async (a) => {
        let projectName: string | null = null;
        if (a.projectId) {
          const [p] = await db.select({ name: proj.name }).from(proj).where(eq(proj.id, a.projectId));
          projectName = p?.name ?? null;
        }
        return {
          id: a.id,
          type: a.type,
          description: a.description,
          projectName,
          createdAt: a.createdAt.toISOString(),
        };
      })
    );

    return {
      totalProjects: projectsCount.count,
      totalL1Tags: l1Count.count,
      totalL2Nodes: l2Count.count,
      totalL3Nodes: l3Count.count,
      pendingReviews: pendingCount.count,
      recentActivity,
    };
  }
}
