import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

export class NotificationService {
  async getNotificationsByProjectId(projectId: number, unreadOnly: boolean) {
    const whereClause = unreadOnly
      ? and(eq(notificationsTable.projectId, projectId), eq(notificationsTable.read, false))
      : eq(notificationsTable.projectId, projectId);

    return await db
      .select()
      .from(notificationsTable)
      .where(whereClause)
      .orderBy(sql`${notificationsTable.createdAt} desc`);
  }

  async markAsRead(notificationId: number) {
    const [updated] = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(eq(notificationsTable.id, notificationId))
      .returning();
    return updated;
  }

  async markAllAsRead(projectId: number) {
    const updated = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.projectId, projectId), eq(notificationsTable.read, false)))
      .returning();
    return updated;
  }
}
