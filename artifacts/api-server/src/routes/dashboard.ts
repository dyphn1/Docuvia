import { Router } from "express";
import { DashboardService } from "@workspace/plugins-domain";

const router = Router();
const dashboardService = new DashboardService();

router.get("/dashboard", async (req, res) => {
  const result = await dashboardService.getDashboardStats();
  res.json(result);
});

export { router as dashboardRouter };
