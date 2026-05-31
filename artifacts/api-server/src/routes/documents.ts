import { Router } from "express";
import { db } from "@workspace/db";
import { documentsTable, projectsTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const AffiliateBodySchema = z.object({
  projectId: z.number().int().positive(),
});

/**
 * GET /documents/misc
 * List all documents that are not affiliated with any project (projectId IS NULL).
 */
router.get("/documents/misc", async (_req, res) => {
  const docs = await db
    .select()
    .from(documentsTable)
    .where(isNull(documentsTable.projectId))
    .orderBy(documentsTable.createdAt);

  return res.json(
    docs.map((d) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
      affiliatedAt: d.affiliatedAt?.toISOString() ?? null,
    }))
  );
});

/**
 * POST /documents/:id/affiliate
 * Associate an unaffiliated document with a project.
 * Body: { projectId: number }
 */
router.post("/documents/:id/affiliate", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid document id" });
  }

  const parsed = AffiliateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
  }

  const { projectId } = parsed.data;

  // Verify project exists
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const [updated] = await db
    .update(documentsTable)
    .set({
      projectId,
      affiliatedAt: new Date(),
      status: "affiliated",
    })
    .where(eq(documentsTable.id, id))
    .returning();

  if (!updated) {
    return res.status(404).json({ error: "Document not found" });
  }

  return res.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    affiliatedAt: updated.affiliatedAt?.toISOString() ?? null,
  });
});

export default router;
