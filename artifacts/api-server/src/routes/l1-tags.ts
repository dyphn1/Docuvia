import { Router } from "express";
import { db } from "@workspace/db";
import { l1TagsTable, activityLogTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  CreateL1TagBody,
  UpdateL1TagParams,
  UpdateL1TagBody,
  DeleteL1TagParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/l1-tags", async (req, res) => {
  const tags = await db
    .select()
    .from(l1TagsTable)
    .orderBy(sql`${l1TagsTable.usageCount} desc`);
  res.json(tags.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })));
});

router.post("/l1-tags", async (req, res) => {
  const body = CreateL1TagBody.parse(req.body);
  const [tag] = await db
    .insert(l1TagsTable)
    .values({
      name: body.name,
      category: body.category,
      description: body.description ?? null,
      isAnchored: body.isAnchored ?? false,
    })
    .returning();
  await db.insert(activityLogTable).values({
    type: "tag_added",
    description: `L1 tag "${tag.name}" added to pool`,
  });
  res.status(201).json({ ...tag, createdAt: tag.createdAt.toISOString() });
});

router.patch("/l1-tags/:id", async (req, res) => {
  const { id } = UpdateL1TagParams.parse({ id: Number(req.params.id) });
  const body = UpdateL1TagBody.parse(req.body);
  const [tag] = await db.update(l1TagsTable).set(body).where(eq(l1TagsTable.id, id)).returning();
  if (!tag) return res.status(404).json({ error: "Not found" });
  return res.json({ ...tag, createdAt: tag.createdAt.toISOString() });
});

router.delete("/l1-tags/:id", async (req, res) => {
  const { id } = DeleteL1TagParams.parse({ id: Number(req.params.id) });
  await db.delete(l1TagsTable).where(eq(l1TagsTable.id, id));
  res.status(204).send();
});

export default router;
