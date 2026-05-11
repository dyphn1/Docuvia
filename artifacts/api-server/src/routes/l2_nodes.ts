import { Router } from "express";
import { db } from "@workspace/db";
import { l2NodesTable, l3NodesTable, l2NodeL1TagsTable, l1TagsTable, activityLogTable, nodeLinksTable } from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";
import {
  CreateL2NodeBody,
  UpdateL2NodeParams,
  UpdateL2NodeBody,
  DeleteL2NodeParams,
} from "@workspace/api-zod";
import { z } from "zod";

const NodeLinkInputSchema = z.object({
  targetNodeId: z.number(),
  linkType: z.string().optional().default("depends_on"),
});

const router = Router();

router.post("/l2-nodes", async (req, res) => {
  const body = CreateL2NodeBody.parse(req.body);
  const [node] = await db.insert(l2NodesTable).values({
    projectId: body.projectId,
    name: body.name,
    type: body.type as any,
    description: body.description ?? null,
    aiGenerated: body.aiGenerated ?? true,
    needsReview: false,
  }).returning();

  if (body.l1TagIds && body.l1TagIds.length > 0) {
    await db.insert(l2NodeL1TagsTable).values(
      body.l1TagIds.map((tagId) => ({ l2NodeId: node.id, l1TagId: tagId }))
    );
    for (const tagId of body.l1TagIds) {
      await db.execute(sql`UPDATE ${l1TagsTable} SET usage_count = usage_count + 1 WHERE id = ${tagId}`);
    }
  }

  await db.insert(activityLogTable).values({
    type: "l2_created",
    description: `L2 node "${node.name}" created`,
    projectId: node.projectId,
  });

  const [l3Row] = await db.select({ count: count() }).from(l3NodesTable).where(eq(l3NodesTable.l2NodeId, node.id));
  res.status(201).json({ ...node, l3Count: l3Row.count, l1TagIds: body.l1TagIds ?? [], createdAt: node.createdAt.toISOString() });
});

router.patch("/l2-nodes/:id", async (req, res) => {
  const { id } = UpdateL2NodeParams.parse({ id: Number(req.params.id) });
  const body = UpdateL2NodeBody.parse(req.body);
  const { l1TagIds, ...rest } = body;
  const [node] = await db.update(l2NodesTable).set(rest as any).where(eq(l2NodesTable.id, id)).returning();
  if (!node) return res.status(404).json({ error: "Not found" });

  if (l1TagIds !== undefined) {
    await db.delete(l2NodeL1TagsTable).where(eq(l2NodeL1TagsTable.l2NodeId, id));
    if (l1TagIds.length > 0) {
      await db.insert(l2NodeL1TagsTable).values(l1TagIds.map((tagId) => ({ l2NodeId: id, l1TagId: tagId })));
    }
  }

  const tags = await db.select({ l1TagId: l2NodeL1TagsTable.l1TagId }).from(l2NodeL1TagsTable).where(eq(l2NodeL1TagsTable.l2NodeId, id));
  const [l3Row] = await db.select({ count: count() }).from(l3NodesTable).where(eq(l3NodesTable.l2NodeId, id));
  res.json({ ...node, l3Count: l3Row.count, l1TagIds: tags.map(t => t.l1TagId), createdAt: node.createdAt.toISOString() });
});

router.delete("/l2-nodes/:id", async (req, res) => {
  const { id } = DeleteL2NodeParams.parse({ id: Number(req.params.id) });
  await db.delete(l2NodesTable).where(eq(l2NodesTable.id, id));
  res.status(204).send();
});

router.get("/l2-nodes/:id/links", async (req, res) => {
  const id = Number(req.params.id);
  const outLinks = await db.select().from(nodeLinksTable).where(eq(nodeLinksTable.sourceNodeId, id));
  const inLinks = await db.select().from(nodeLinksTable).where(eq(nodeLinksTable.targetNodeId, id));
  const all = [...outLinks, ...inLinks];
  const result = await Promise.all(all.map(async (link) => {
    const [src] = await db.select({ name: l2NodesTable.name }).from(l2NodesTable).where(eq(l2NodesTable.id, link.sourceNodeId));
    const [tgt] = await db.select({ name: l2NodesTable.name }).from(l2NodesTable).where(eq(l2NodesTable.id, link.targetNodeId));
    return {
      ...link,
      sourceNodeName: src?.name ?? null,
      targetNodeName: tgt?.name ?? null,
      createdAt: link.createdAt.toISOString(),
    };
  }));
  res.json(result);
});

router.post("/l2-nodes/:id/links", async (req, res) => {
  const sourceNodeId = Number(req.params.id);
  const body = NodeLinkInputSchema.parse(req.body);
  const [link] = await db.insert(nodeLinksTable).values({
    sourceNodeId,
    targetNodeId: body.targetNodeId,
    linkType: body.linkType ?? "depends_on",
  }).returning();
  const [src] = await db.select({ name: l2NodesTable.name }).from(l2NodesTable).where(eq(l2NodesTable.id, sourceNodeId));
  const [tgt] = await db.select({ name: l2NodesTable.name }).from(l2NodesTable).where(eq(l2NodesTable.id, body.targetNodeId));
  res.status(201).json({
    ...link,
    sourceNodeName: src?.name ?? null,
    targetNodeName: tgt?.name ?? null,
    createdAt: link.createdAt.toISOString(),
  });
});

export default router;
