import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import projectsRouter from "./projects";
import l1TagsRouter from "./l1_tags";
import l2NodesRouter from "./l2_nodes";
import l3NodesRouter from "./l3_nodes";
import reviewTasksRouter from "./review_tasks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(projectsRouter);
router.use(l1TagsRouter);
router.use(l2NodesRouter);
router.use(l3NodesRouter);
router.use(reviewTasksRouter);

export default router;
