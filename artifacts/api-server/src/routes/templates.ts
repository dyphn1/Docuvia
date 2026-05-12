import { Router } from "express";
import { db } from "@workspace/db";
import { promptTemplatesTable, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const DEFAULT_PROMPTS: Record<string, string> = {
  l1_tagger: `You are an expert software architect. Analyze VCS commit messages and extract L1 classification tags.
L1 tags are high-level domain classifications (e.g., "Authentication", "Database", "Networking", "Build System", "Security", "Performance", "UI", "API", "Testing", "Documentation").
Return ONLY a JSON array of tag objects. Each object must have: name (string), category (string), description (string).
Categories: Core, Infrastructure, Quality, Feature, Security, Performance.
Generate 3-8 tags that best represent the commit themes. Prefer reusing existing tags when they match.`,

  l2_extractor: `You are an expert software architect analyzing VCS commit history.
Extract L2 nodes (packages/modules/components) and their associated L3 knowledge nodes.

L2 nodes = software components, modules, packages, or PCDs (Platform Configuration Databases for UEFI/firmware).
L3 nodes = implementation rules, technical decisions, change rationale, context.

Return ONLY a valid JSON array. Each L2 node:
{
  "name": "component-name",
  "type": "module" | "package" | "pcd",
  "description": "what this component does",
  "l1TagNames": ["matching tag names from the available list"],
  "l3Nodes": [
    {
      "title": "concise title",
      "nodeType": "change" | "rule" | "decision" | "context",
      "content": "detailed explanation",
      "commitHash": "8-char hash from [xxxxxxxx] prefix or empty string",
      "confidence": 0.0 to 1.0
    }
  ]
}

confidence: 1.0 = certain/explicit in commits, 0.7 = inferred with high confidence, 0.4 = speculative.
Generate 2-6 L2 nodes with 1-3 L3 nodes each.`,

  l3_generator: `You are an expert software architect extracting implementation knowledge.
Generate detailed L3 knowledge nodes (implementation rules, technical decisions, rationale, context) from the given commits and module context.
Focus on: WHY decisions were made, HOW things work, WHAT constraints exist, WHEN patterns apply.
Return ONLY a valid JSON array of L3 node objects.`,
};

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
export { DEFAULT_PROMPTS };
