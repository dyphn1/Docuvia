import { db } from "@workspace/db";
import {
  projectsTable,
  l1TagsTable,
  l2NodesTable,
  l3NodesTable,
  reviewTasksTable,
  activityLogTable,
} from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";

import { IDashboardService } from "@workspace/core";

export class DashboardService implements IDashboardService {
  async getDashboardStats() {
    const [[projectsCount], [l1Count], [l2Count], [l3Count], [pendingCount]] = await Promise.all([
      db.select({ count: count() }).from(projectsTable),
      db.select({ count: count() }).from(l1TagsTable),
      db.select({ count: count() }).from(l2NodesTable),
      db.select({ count: count() }).from(l3NodesTable),
      db
        .select({ count: count() })
        .from(reviewTasksTable)
        .where(eq(reviewTasksTable.status, "pending")),
    ]);

    const activityRows = await db
      .select({
        id: activityLogTable.id,
        type: activityLogTable.type,
        description: activityLogTable.description,
        createdAt: activityLogTable.createdAt,
        projectName: projectsTable.name,
      })
      .from(activityLogTable)
      .leftJoin(projectsTable, eq(activityLogTable.projectId, projectsTable.id))
      .orderBy(sql`${activityLogTable.createdAt} desc`)
      .limit(10);

    const recentActivity = activityRows.map((a) => ({
      id: a.id,
      type: a.type,
      description: a.description,
      projectName: a.projectName ?? null,
      createdAt: a.createdAt.toISOString(),
    }));

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
