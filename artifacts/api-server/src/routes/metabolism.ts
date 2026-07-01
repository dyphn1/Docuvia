import { Router, Request, Response } from "express";
import { logger } from "@workspace/core";
import { pool } from "@workspace/db";
import { requireApiKey } from "../middlewares/auth.js";
import { MetabolismService } from "../services/metabolism.service.js";

const METABOLISM_LOCK_ID = 123456789;

const metabolismRouter = Router();

async function withMetabolismLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [
      METABOLISM_LOCK_ID,
    ]);
    if (result.rows[0]?.locked !== true) return null;
    locked = true;
    return await fn();
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [METABOLISM_LOCK_ID])
        .catch((err) => logger.warn({ err }, "Ignored error"));
    }
    client.release();
  }
}

metabolismRouter.get(
  "/metabolism-tick",
  requireApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await withMetabolismLock(async () => {
        await new MetabolismService().runAll();
      });
      if (result === null) {
        res.status(202).json({ message: "Metabolism is already running", status: "accepted" });
        return;
      }
      res.status(200).json({ message: "Metabolism tick completed", status: "success" });
    } catch (err) {
      logger.error({ err }, "Metabolism tick failed");
      res.status(500).json({ error: "Metabolism tick failed" });
    }
  }
);

metabolismRouter.get(
  "/admin/metabolism-tick",
  async (req: Request, res: Response): Promise<void> => {
    let adminSecret = process.env.ADMIN_SECRET_TOKEN;

    if (!adminSecret) {
      if (process.env.NODE_ENV === "development") {
        adminSecret = "dev-secret-token";
      } else {
        logger.error("ADMIN_SECRET_TOKEN is missing. Server misconfigured. Failing closed.");
        res.status(500).json({ error: "Server misconfiguration" });
        return;
      }
    }

    let token = req.query.admin_token as string | undefined;

    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.substring(7);
    }

    if (!token || token !== adminSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const result = await withMetabolismLock(async () => {
        await new MetabolismService().runAll();
      });
      if (result === null) {
        res.status(202).json({ message: "Metabolism is already running", status: "accepted" });
        return;
      }
      res.status(200).json({ message: "Metabolism tick completed manually", status: "success" });
    } catch (err) {
      logger.error({ err }, "Admin metabolism tick failed");
      res.status(500).json({ error: "Metabolism tick failed" });
    }
  }
);

export { metabolismRouter };
