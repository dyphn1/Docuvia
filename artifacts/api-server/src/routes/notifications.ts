import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  ListProjectNotificationsParams,
  ListProjectNotificationsQueryParams,
  MarkNotificationReadParams,
  MarkAllNotificationsReadBody,
} from "@workspace/api-zod";
import { logger } from "@workspace/core";

const router = Router();

router.get("/projects/:projectId/notifications", async (req, res) => {
  try {
    const params = ListProjectNotificationsParams.parse(req.params);
    const query = ListProjectNotificationsQueryParams.parse(req.query);

    const whereClause = query.unreadOnly
      ? and(eq(notificationsTable.projectId, params.projectId), eq(notificationsTable.read, false))
      : eq(notificationsTable.projectId, params.projectId);

    const items = await db
      .select()
      .from(notificationsTable)
      .where(whereClause)
      .orderBy(sql`${notificationsTable.createdAt} desc`);

    return res.json({
      items: items.map((n) => ({
        ...n,
        payload: n.payload ?? {},
        createdAt: n.createdAt.toISOString(),
      })),
      total: items.length,
    });
  } catch (err: unknown) {
    logger.error({ err }, "Failed to list notifications");
    return res.status(500).json({ error: "Failed to list notifications" });
  }
});

router.patch("/notifications/:notificationId/read", async (req, res) => {
  try {
    const params = MarkNotificationReadParams.parse(req.params);

    const [updated] = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(eq(notificationsTable.id, params.notificationId))
      .returning();

    if (!updated) return res.status(404).json({ error: "Notification not found" });

    return res.json({
      ...updated,
      payload: updated.payload ?? {},
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err: unknown) {
    logger.error({ err }, "Failed to mark notification as read");
    return res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

router.post("/notifications/mark-all-read", async (req, res) => {
  try {
    const body = MarkAllNotificationsReadBody.parse(req.body);

    const updated = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(
        and(eq(notificationsTable.projectId, body.projectId), eq(notificationsTable.read, false))
      )
      .returning();

    return res.json({ updated: updated.length });
  } catch (err: unknown) {
    logger.error({ err }, "Failed to mark all notifications as read");
    return res.status(500).json({ error: "Failed to mark all notifications as read" });
  }
});

export { router as notificationsRouter };
