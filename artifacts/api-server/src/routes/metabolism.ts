import { API_MESSAGES } from "@workspace/core";
import { Router, Request, Response } from "express";
import { logger } from "@workspace/core";
import { requireApiKey } from "../middlewares/auth.js";
import { MetabolismService } from "../services/metabolism.service.js";

const metabolismRouter = Router();

metabolismRouter.get(
  "/metabolism-tick",
  requireApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const service = new MetabolismService();
      const result = await service.withMetabolismLock(async () => {
        await service.runAll();
      });
      if (result === null) {
        res
          .status(202)
          .json({ message: API_MESSAGES.METABOLISM_ALREADY_RUNNING, status: "accepted" });
        return;
      }
      res.status(200).json({ message: API_MESSAGES.METABOLISM_TICK_COMPLETED, status: "success" });
    } catch (err) {
      logger.error({ err }, "Metabolism tick failed");
      res.status(500).json({ error: API_MESSAGES.METABOLISM_TICK_FAILED });
    }
  }
);

metabolismRouter.get(
  "/admin/metabolism-tick",
  async (req: Request, res: Response): Promise<void> => {
    const adminSecret = process.env.ADMIN_SECRET_TOKEN;

    if (!adminSecret) {
      logger.error("ADMIN_SECRET_TOKEN is missing. Server misconfigured. Failing closed.");
      res.status(500).json({ error: API_MESSAGES.SERVER_MISCONFIGURATION });
      return;
    }

    let token = req.query.admin_token as string | undefined;

    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.substring(7);
    }

    if (!token || token !== adminSecret) {
      res.status(401).json({ error: API_MESSAGES.UNAUTHORIZED });
      return;
    }

    try {
      const service = new MetabolismService();
      const result = await service.withMetabolismLock(async () => {
        await service.runAll();
      });
      if (result === null) {
        res
          .status(202)
          .json({ message: API_MESSAGES.METABOLISM_ALREADY_RUNNING, status: "accepted" });
        return;
      }
      res
        .status(200)
        .json({ message: API_MESSAGES.METABOLISM_TICK_COMPLETED_MANUALLY, status: "success" });
    } catch (err) {
      logger.error({ err }, "Admin metabolism tick failed");
      res.status(500).json({ error: API_MESSAGES.METABOLISM_TICK_FAILED });
    }
  }
);

export { metabolismRouter };
