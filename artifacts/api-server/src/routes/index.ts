import { Router, type IRouter } from "express";
import { healthRouter } from "./health";
import { dashboardRouter } from "./dashboard";
import { projectsRouter } from "./projects";
import { l1TagsRouter } from "./l1-tags";
import { l2NodesRouter } from "./l2-nodes";
import { l3NodesRouter } from "./l3-nodes";
import { reviewTasksRouter } from "./review-tasks";
import { ingestRouter } from "./ingest";
import { generateRouter } from "./generate";
import { searchRouter } from "./search";
import { mcpRouter } from "./mcp";
import { llmConfigRouter } from "./llm-config";
import { exportRouter } from "./export";
import { topologyRouter } from "./topology";
import { templatesRouter } from "./templates";
import { subscriptionsRouter } from "./subscriptions";
import { notificationsRouter } from "./notifications";
import { pullRequestsRouter } from "./pull-requests";
import { extensionsVscodeRouter } from "./extensions-vscode";
import { integrationsRouter } from "./integrations";
import { syncRouter } from "./sync";
import { documentsRouter } from "./documents";
import { metabolismRouter } from "./metabolism";
import { requireApiKey } from "../middlewares/auth.js";
import { standardLimiter, mcpLimiter } from "../lib/rate-limit";

const router: IRouter = Router();

// Apply standard rate limiter to all routes by default
router.use(standardLimiter);

// Specific limiters can be applied by the individual routers or overriding below
router.use("/mcp", mcpLimiter);
router.use("/search", mcpLimiter);

router.use(healthRouter);
router.use(mcpRouter);

// Apply auth to all subsequent API routes
router.use(requireApiKey);

router.use(dashboardRouter);
router.use(projectsRouter);
router.use(l1TagsRouter);
router.use(l2NodesRouter);
router.use(l3NodesRouter);
router.use(reviewTasksRouter);
router.use(ingestRouter);
router.use(generateRouter);
router.use(searchRouter);
router.use(llmConfigRouter);
router.use(exportRouter);
router.use(topologyRouter);
router.use(templatesRouter);
router.use(subscriptionsRouter);
router.use(notificationsRouter);
router.use(pullRequestsRouter);
router.use(extensionsVscodeRouter);
router.use(integrationsRouter);
router.use(syncRouter);
router.use(documentsRouter);
router.use(metabolismRouter);

export { router as routes };
