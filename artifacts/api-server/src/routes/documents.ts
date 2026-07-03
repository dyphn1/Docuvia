import { Router } from "express";
import { ProjectService } from "../services/project.service";
import { DocumentService } from "@workspace/plugins-domain";
import { z } from "zod";
import { documentUpload } from "../middlewares/upload.js";
import { logger } from "@workspace/core";
import { requireApiKey } from "../middlewares/auth";
import fs from "fs";

const router = Router();
const documentService = new DocumentService();

import { AffiliateDocumentBody } from "@workspace/api-zod";

/**
 * GET /documents/misc
 * List all documents that are not affiliated with any project (projectId IS NULL).
 */
router.get("/documents/misc", async (_req, res) => {
  const result = await documentService.listMiscDocuments();
  return res.json(result);
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

  const parsed = AffiliateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
  }

  const { projectId } = parsed.data;

  // Verify project exists
  const project = await new ProjectService().getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const updated = await documentService.affiliateDocument(id, projectId);

  if (!updated) {
    return res.status(404).json({ error: "Document not found" });
  }

  return res.json(updated);
});

// POST /documents (Upload to Misc Pool)
router.post("/documents", requireApiKey, documentUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required" });

  const uploadedBy = (req as any).user?.id;
  if (!uploadedBy) return res.status(401).json({ error: "Unauthorized" });

  try {
    const inserted = await documentService.processAndSaveDocument(req.file, uploadedBy);
    return res.json(inserted);
  } catch (err: any) {
    if (err.message === "QUOTA_EXCEEDED") {
      return res.status(429).json({
        error: "Misc Pool quota exceeded. Please associate existing documents to a project.",
      });
    }
    if (err.message === "MISSING_FILE_PATH") {
      return res.status(400).json({ error: "Uploaded file path is missing" });
    }
    if (err.message === "INVALID_SIGNATURE_PDF") {
      return res.status(400).json({ error: "Invalid file signature. Not a true PDF." });
    }
    if (err.message === "INVALID_SIGNATURE_OFFICE") {
      return res
        .status(400)
        .json({ error: "Invalid file signature. Not a valid Office document." });
    }

    logger.error({ err }, "[POST /documents] Unhandled error");
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        logger.warn({ err: e, path: req.file.path }, "Failed to delete temp file");
      }
    }
  }
});

export { router as documentsRouter };
