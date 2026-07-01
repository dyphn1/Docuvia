import { Router } from "express";
import { db } from "@workspace/db";
import { l2NodesTable, l3NodesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { routeQuery } from "@workspace/core";

const router = Router();

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
    // For now, simply update the lastVerifiedAt for l2 or l3, or any node
    // A robust implementation would log this interaction based on interactionType
    if (nodeLayer === "l2") {
      await db
        .update(l2NodesTable)
        .set({ lastVerifiedAt: new Date() })
        .where(eq(l2NodesTable.id, nodeId));
    } else if (nodeLayer === "l3") {
      await db
        .update(l3NodesTable)
        .set({ lastVerifiedAt: new Date() })
        .where(eq(l3NodesTable.id, nodeId));
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

export { router as searchRouter };
