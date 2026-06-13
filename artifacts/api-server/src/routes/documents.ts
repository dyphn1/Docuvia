import { Router } from "express";
import fs from "fs";
import { count } from "drizzle-orm";
import { db } from "@workspace/db";
import { documentsTable, projectsTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { documentUpload } from "../middlewares/upload.js";
import { detectDocType } from "../lib/document-parser.js";
import { computeHashFromStream } from "../lib/utils/hash.js";
import { logger } from "../lib/logger.js";

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


// POST /documents (Upload to Misc Pool)
router.post("/documents", documentUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required" });
  
  // Fake userId extracted from bearer token (implementation pending auth middleware)
  const uploadedBy = (req as any).user?.id || 1; 

  // Max's Rule: Enforce a strict file count quota for the anonymous pool
  const [quotaCheck] = await db
    .select({ count: count() })
    .from(documentsTable)
    .where(isNull(documentsTable.projectId));
    
  if (quotaCheck.count >= 1000) {
    return res.status(429).json({ error: "Misc Pool quota exceeded. Please associate existing documents to a project." });
  }

  try {
    const filePath = req.file.path;
    
    // Max's Rule: Validate Magic Bytes to prevent Zip bombs and XXE via spoofed extensions
    const fileBuffer = await fs.promises.readFile(filePath);
    const hexHeader = fileBuffer.toString('hex', 0, 4).toUpperCase();
    
    // PDF magic bytes: 25504446
    // DOCX/PPTX (ZIP) magic bytes: 504B0304
    const docType = detectDocType(req.file.originalname);
    if (docType === "pdf" && !hexHeader.startsWith("25504446")) {
      await fs.promises.unlink(filePath).catch(() => {});
      return res.status(400).json({ error: "Invalid file signature. Not a true PDF." });
    }
    if ((docType === "docx" || docType === "pptx") && !hexHeader.startsWith("504B0304")) {
      await fs.promises.unlink(filePath).catch(() => {});
      return res.status(400).json({ error: "Invalid file signature. Not a valid Office document." });
    }

    const contentHash = await computeHashFromStream(filePath);
    const rawContent = await fs.promises.readFile(filePath, "utf-8");

    const [inserted] = await db.insert(documentsTable).values({
      filename: req.file.originalname,
      content: rawContent,
      docType,
      contentHash,
      // Max's Rule: Explicit status flag so background workers ignore it
      validityStatus: 'pending_affiliation',
      uploadedBy, 
    }).returning();

    await fs.promises.unlink(filePath).catch(() => {});
    return res.json(inserted);
  } catch (err) {
    logger.error({ err }, "[POST /documents] Unhandled error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
