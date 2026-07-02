import { Router } from "express";
import {
  ListProjectNotificationsParams,
  ListProjectNotificationsQueryParams,
  MarkNotificationReadParams,
  MarkAllNotificationsReadBody,
} from "@workspace/api-zod";
import { logger } from "@workspace/core";
import { NotificationService } from "../services/notification.service";

const router = Router();
const notificationService = new NotificationService();

router.get("/projects/:projectId/notifications", async (req, res) => {
  try {
    const params = ListProjectNotificationsParams.parse(req.params);
    const query = ListProjectNotificationsQueryParams.parse(req.query);

    const items = await notificationService.getNotificationsByProjectId(
      params.projectId,
      query.unreadOnly ?? false
    );

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

    const updated = await notificationService.markAsRead(params.notificationId);

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

    const updated = await notificationService.markAllAsRead(body.projectId);

    return res.json({ updated: updated.length });
  } catch (err: unknown) {
    logger.error({ err }, "Failed to mark all notifications as read");
    return res.status(500).json({ error: "Failed to mark all notifications as read" });
  }
});

export { router as notificationsRouter };
