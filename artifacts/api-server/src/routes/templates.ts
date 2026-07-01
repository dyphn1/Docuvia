import { Router } from "express";
import { db } from "@workspace/db";
import { promptTemplatesTable, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_PROMPTS } from "@workspace/core";

const router = Router();

const TemplateUpdateSchema = z.object({
  systemPrompt: z.string().min(10),
});

router.get("/projects/:id/templates", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const types = ["l1_tagger", "l2_extractor", "l3_generator"] as const;
  const dbTemplates = await db
    .select()
    .from(promptTemplatesTable)
    .where(eq(promptTemplatesTable.projectId, projectId));

  const dbMap = new Map(dbTemplates.map((t) => [t.templateType, t]));

  const result = types.map((type) => {
    const existing = dbMap.get(type);
    return {
      templateType: type,
      systemPrompt: existing?.systemPrompt ?? DEFAULT_PROMPTS[type] ?? "",
      isCustom: !!existing,
      isActive: existing?.isActive ?? true,
      id: existing?.id ?? null,
      updatedAt: existing?.updatedAt?.toISOString() ?? null,
    };
  });

  return res.json(result);
});

router.put("/projects/:id/templates/:type", async (req, res) => {
  const projectId = Number(req.params.id);
  const templateType = req.params.type as "l1_tagger" | "l2_extractor" | "l3_generator";

  const validTypes = ["l1_tagger", "l2_extractor", "l3_generator"];
  if (!validTypes.includes(templateType)) {
    return res.status(400).json({ error: "Invalid template type" });
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const body = TemplateUpdateSchema.parse(req.body);

  const [existing] = await db
    .select()
    .from(promptTemplatesTable)
    .where(
      and(
        eq(promptTemplatesTable.projectId, projectId),
        eq(promptTemplatesTable.templateType, templateType as any)
      )
    );

  if (existing) {
    const [updated] = await db
      .update(promptTemplatesTable)
      .set({ systemPrompt: body.systemPrompt, updatedAt: new Date() })
      .where(eq(promptTemplatesTable.id, existing.id))
      .returning();
    return res.json({
      ...updated,
      isCustom: true,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  }

  const [created] = await db
    .insert(promptTemplatesTable)
    .values({
      projectId,
      templateType: templateType as any,
      systemPrompt: body.systemPrompt,
      isActive: true,
    })
    .returning();

  return res.status(201).json({
    ...created,
    isCustom: true,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  });
});

router.delete("/projects/:id/templates/:type", async (req, res) => {
  const projectId = Number(req.params.id);
  const templateType = req.params.type;

  await db
    .delete(promptTemplatesTable)
    .where(
      and(
        eq(promptTemplatesTable.projectId, projectId),
        eq(promptTemplatesTable.templateType, templateType as any)
      )
    );

  return res.status(204).send();
});

export default router;
