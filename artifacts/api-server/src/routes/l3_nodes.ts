import { Router } from "express";
import { db } from "@workspace/db";
import { l3NodesTable, activityLogTable, l2NodesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  ListL3NodesParams,
  CreateL3NodeParams,
  CreateL3NodeBody,
  UpdateL3NodeParams,
  UpdateL3NodeBody,
  DeleteL3NodeParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/l2-nodes/:id/l3-nodes", async (req, res) => {
  const { id } = ListL3NodesParams.parse({ id: Number(req.params.id) });
  const nodes = await db.select().from(l3NodesTable).where(eq(l3NodesTable.l2NodeId, id)).orderBy(sql`${l3NodesTable.createdAt} desc`);
  res.json(nodes.map(n => ({ ...n, createdAt: n.createdAt.toISOString() })));
});

router.post("/l2-nodes/:id/l3-nodes", async (req, res) => {
  const { id } = CreateL3NodeParams.parse({ id: Number(req.params.id) });
  const body = CreateL3NodeBody.parse(req.body);
  const [node] = await db.insert(l3NodesTable).values({
    l2NodeId: id,
    title: body.title,
    content: body.content ?? null,
    nodeType: body.nodeType as any,
    commitHash: body.commitHash ?? null,
    aiGenerated: body.aiGenerated ?? true,
    confidence: body.confidence ?? null,
  }).returning();

  const [l2] = await db.select().from(l2NodesTable).where(eq(l2NodesTable.id, id));
  await db.insert(activityLogTable).values({
    type: "l3_created",
    description: `L3 node "${node.title}" created`,
    projectId: l2?.projectId ?? null,
  });

  res.status(201).json({ ...node, createdAt: node.createdAt.toISOString() });
});

router.patch("/l3-nodes/:id", async (req, res) => {
  const { id } = UpdateL3NodeParams.parse({ id: Number(req.params.id) });
  const body = UpdateL3NodeBody.parse(req.body);
  const [node] = await db.update(l3NodesTable).set(body as any).where(eq(l3NodesTable.id, id)).returning();
  if (!node) return res.status(404).json({ error: "Not found" });
  res.json({ ...node, createdAt: node.createdAt.toISOString() });
});

router.delete("/l3-nodes/:id", async (req, res) => {
  const { id } = DeleteL3NodeParams.parse({ id: Number(req.params.id) });
  await db.delete(l3NodesTable).where(eq(l3NodesTable.id, id));
  res.status(204).send();
});

export default router;
