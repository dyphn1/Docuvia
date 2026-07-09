import { Router } from "express";
import { ProjectService } from "../services/project.service.js";
import { DI_TOKENS, IDocumentService } from "@workspace/core";
import { container } from "../di.js";
import { z } from "zod";
import { documentUpload } from "../middlewares/upload.js";
import { logger } from "@workspace/core";
import { requireApiKey } from "../middlewares/auth.js";
import fs from "fs";
import { API_MESSAGES } from "@workspace/core";

const router = Router();

import { AffiliateDocumentBody } from "@workspace/api-zod";

/**
 * GET /documents/misc
 * List all documents that are not affiliated with any project (projectId IS NULL).
 */
router.get("/documents/misc", async (_req, res) => {
  const documentService = container.resolve<IDocumentService>(DI_TOKENS.DocumentService);
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
    return res.status(400).json({ error: API_MESSAGES.INVALID_DOCUMENT_ID });
  }

  const parsed = AffiliateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? API_MESSAGES.INVALID_REQUEST_BODY });
  }

  const { projectId } = parsed.data;

  // Verify project exists
  const project = await new ProjectService().getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: API_MESSAGES.PROJECT_NOT_FOUND });
  }

  const documentService = container.resolve<IDocumentService>(DI_TOKENS.DocumentService);
  const updated = await documentService.affiliateDocument(id, projectId);

  if (!updated) {
    return res.status(404).json({ error: API_MESSAGES.DOCUMENT_NOT_FOUND });
  }

  return res.json(updated);
});

// POST /documents (Upload to Misc Pool)
router.post("/documents", requireApiKey, documentUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: API_MESSAGES.FILE_REQUIRED });

  const uploadedBy = (req as any).user?.id;
  if (!uploadedBy) return res.status(401).json({ error: API_MESSAGES.UNAUTHORIZED });

  const documentService = container.resolve<IDocumentService>(DI_TOKENS.DocumentService);

  try {
    const inserted = await documentService.processAndSaveDocument(req.file, uploadedBy);
    return res.json(inserted);
  } catch (err: any) {
    if (err.message === "QUOTA_EXCEEDED") {
      return res.status(429).json({
        error: API_MESSAGES.MISC_POOL_QUOTA_EXCEEDED,
      });
    }
    if (err.message === "MISSING_FILE_PATH") {
      return res.status(400).json({ error: API_MESSAGES.UPLOADED_FILE_PATH_MISSING });
    }
    if (err.message === "INVALID_SIGNATURE_PDF") {
      return res.status(400).json({ error: API_MESSAGES.INVALID_SIGNATURE_PDF });
    }
    if (err.message === "INVALID_SIGNATURE_OFFICE") {
      return res.status(400).json({ error: API_MESSAGES.INVALID_SIGNATURE_OFFICE });
    }

    logger.error({ err }, "[POST /documents] Unhandled error");
    return res.status(500).json({ error: API_MESSAGES.INTERNAL_SERVER_ERROR });
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
