import { Router } from "express";
import { DI_TOKENS, IDashboardService } from "@workspace/core";
import { container } from "../di.js";

const router = Router();

router.get("/dashboard", async (req, res) => {
  const dashboardService = container.resolve<IDashboardService>(DI_TOKENS.DashboardService);
  const result = await dashboardService.getDashboardStats();
  res.json(result);
});

export { router as dashboardRouter };
