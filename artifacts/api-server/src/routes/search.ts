import { Router } from "express";
import { z } from "zod";
import { routeQuery } from "@workspace/core";
import { SearchService } from "../services/search.service.js";

const router = Router();
const searchService = new SearchService();

const SearchSchema = z.object({
  query: z.string().min(1),
  projectId: z.number().optional(),
  limit: z.number().optional().default(20),
});

const FeedbackSchema = z.object({
  nodeId: z.number().int().positive(),
  nodeLayer: z.enum(["l1", "l2", "l3", "commit"]),
  interactionType: z.enum(["view", "click", "copy", "citation"]),
});

router.post("/search", async (req, res) => {
  const body = SearchSchema.parse(req.body);
  const { query, projectId, limit } = body;

  try {
    const routeResult = await routeQuery(query, projectId, limit);
    res.json({ results: routeResult.results, total: routeResult.results.length });
  } catch (error) {
    res.status(500).json({ error: "Search failed" });
  }
});

router.post("/search/feedback", async (req, res) => {
  const body = FeedbackSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid feedback payload", details: body.error.errors });
    return;
  }

  const { nodeId, nodeLayer, interactionType } = body.data;

  try {
    await searchService.processFeedback(nodeId, nodeLayer, interactionType);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

export { router as searchRouter };
