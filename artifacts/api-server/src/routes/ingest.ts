import { Router } from "express";
import { ProjectService } from "../services/project.service";
import fs from "fs";
import { IngestSvnBody, IngestDocumentBody } from "@workspace/api-zod";
import { z } from "zod";
import { documentUpload } from "../middlewares/upload.js";
import multer from "multer";
import { logger } from "@workspace/core";
import { requireApiKey } from "../middlewares/auth.js";
import { GitIngestionService } from "../services/git-ingestion.service.js";
import { SvnIngestionService } from "../services/svn-ingestion.service.js";
import { DocumentIngestionService } from "../services/doc-ingestion.service.js";
import { DocumentService } from "../services/document.service.js";
import { AstIngestionService } from "../services/ast-ingestion.service.js";
import { ProjectStatusService } from "../services/project-status.service.js";

const router = Router();
const gitIngestionService = new GitIngestionService();
const svnIngestionService = new SvnIngestionService();
const docIngestionService = new DocumentIngestionService();
const documentService = new DocumentService();
const astIngestionService = new AstIngestionService();
const projectStatusService = new ProjectStatusService();

const GitIngestSchema = z.object({
  repoUrl: z.string().optional(),
  branch: z.string().optional().default("main"),
  limit: z.number().optional().default(100),
  githubToken: z.string().optional(),
  mode: z.enum(["full", "incremental"]).optional().default("full"),
});

const SvnModeSchema = z.object({
  mode: z.enum(["full", "incremental"]).optional().default("full"),
});

router.post("/projects/:id/ingest/git", requireApiKey, async (req, res) => {
  const projectId = Number(req.params.id);
  const project = await new ProjectService().getProjectById(projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const body = GitIngestSchema.parse(req.body);
  const repoUrl = body.repoUrl ?? project.repoUrl;

  if (!repoUrl) {
    return res.status(400).json({ error: "repoUrl is required" });
  }

  try {
    const result = await gitIngestionService.ingestGit(project, {
      repoUrl,
      branch: body.branch ?? "main",
      limit: Math.min(body.limit ?? 100, 500),
      mode: body.mode ?? "full",
    });

    return res.json({
      commitsIngested: result.ingested,
      commitsSkipped: result.skipped,
      totalFetched: result.totalFetched,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (err: any) {
    logger.error({ err }, "Git ingestion failed");
    return res.status(500).json({ error: `Git ingestion failed: ${err.message}` });
  }
});

router.post("/projects/:id/ingest/svn", requireApiKey, async (req, res) => {
  const projectId = Number(req.params.id);
  const project = await new ProjectService().getProjectById(projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  let body: ReturnType<typeof IngestSvnBody.parse>;
  try {
    body = IngestSvnBody.parse(req.body);
  } catch (err) {
    return res.status(400).json({ error: "Invalid request body", details: err });
  }

  const { mode: svnMode } = SvnModeSchema.parse(req.body);
  const svnUrl = body.svnUrl;

  if (!/^https?:\/\/|^svn:\/\/|^svn\+ssh:\/\//.test(svnUrl)) {
    return res.status(400).json({ error: "Invalid SVN URL format" });
  }

  try {
    const result = await svnIngestionService.ingestSvn(project, {
      svnUrl,
      username: body.username,
      password: body.password,
      startRevision: body.startRevision,
      endRevision: body.endRevision,
      mode: svnMode,
    });

    return res.json({
      ingested: result.ingested,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (err: any) {
    return res.status(502).json({ error: `Failed to fetch SVN log: ${err.message}` });
  }
});

router.get("/projects/:id/ingest/status", async (req, res) => {
  const projectId = Number(req.params.id);
  const project = await new ProjectService().getProjectById(projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  try {
    const status = await projectStatusService.getStatus(projectId, project);
    return res.json(status);
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to get status: ${err.message}` });
  }
});

router.post(
  "/projects/:id/ingest/document/upload",
  documentUpload.single("file"),
  async (req, res, next) => {
    const projectId = Number(req.params.id);
    const project = await new ProjectService().getProjectById(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (!req.file) {
      return res
        .status(400)
        .json({ error: "No file uploaded. Use multipart/form-data with field name 'file'." });
    }

    try {
      const { originalname, path: filePath } = req.file;
      const commitSha = req.body.commitSha as string | undefined;

      const result = await docIngestionService.ingestDocumentFromFile(
        project,
        filePath,
        originalname,
        commitSha
      );

      if (result.skipped) {
        return res.status(409).json({ error: "Document already exists" });
      }

      return res
        .status(201)
        .json({ ...result.document, createdAt: result.document?.createdAt.toISOString() });
    } catch (err: any) {
      if (err.message === "Extracted content is empty") {
        return res.status(422).json({
          error:
            "Extracted content is empty. The document may be encrypted or contain only images.",
        });
      }
      if (err.message.startsWith("Failed to parse document")) {
        return res.status(422).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message });
    } finally {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          logger.warn({ err: e, path: req.file.path }, "Failed to delete temp file");
        }
      }
    }
  }
);

router.post("/projects/:id/ingest/document", async (req, res) => {
  const projectId = Number(req.params.id);
  const project = await new ProjectService().getProjectById(projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  let body;
  try {
    body = IngestDocumentBody.parse(req.body);
  } catch (err) {
    return res.status(400).json({ error: "Invalid request body", details: err });
  }

  try {
    const result = await docIngestionService.ingestDocumentFromContent(
      project,
      body.filename,
      body.content,
      body.commitSha ?? undefined,
      body.docType as any
    );

    if (result.skipped) {
      return res.status(409).json({ error: "Document already exists" });
    }

    return res
      .status(201)
      .json({ ...result.document, createdAt: result.document?.createdAt.toISOString() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/projects/:id/documents", async (req, res) => {
  const projectId = Number(req.params.id);
  const docs = await documentService.listDocumentsByProjectId(projectId);
  res.json(docs);
});

const AstIngestSchema = z.object({
  jsonlPaths: z.union([z.string(), z.array(z.string())]).optional(),
  jsonlPath: z.string().optional(),
  mode: z.enum(["full", "incremental"]).optional().default("full"),
});

router.post("/projects/:id/ingest/ast", async (req, res) => {
  const projectId = Number(req.params.id);
  const project = await new ProjectService().getProjectById(projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  try {
    const body = AstIngestSchema.parse(req.body);
    const paths = body.jsonlPaths ?? body.jsonlPath;
    if (!paths) {
      return res.status(400).json({ error: "jsonlPath or jsonlPaths is required" });
    }

    const mode = body.mode ?? "full";
    const result = await astIngestionService.dispatchAstIngestion(projectId, paths, mode);

    return res.status(202).json(result);
  } catch (err: any) {
    logger.error({ err, projectId }, "AST ingestion endpoint failed");
    return res.status(500).json({ error: `AST ingestion dispatch failed: ${err.message}` });
  }
});

router.use(
  (
    err: unknown,
    _req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction
  ) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File too large. Maximum size is 10 MB." });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err instanceof Error && err.message.startsWith("Unsupported file type")) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
);

router.post(
  "/projects/:id/ingest/build-artifact",
  documentUpload.single("file"),
  async (req, res) => {
    const projectId = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: "file required" });
    const project = await new ProjectService().getProjectById(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    try {
      const filePath = req.file.path;
      if (!filePath) {
        return res.status(400).json({ error: "Uploaded file path is missing" });
      }

      const result = await docIngestionService.ingestBuildArtifactFromFile(
        project,
        filePath,
        req.file.originalname
      );
      return res.json(result);
    } catch (err) {
      logger.error(
        { err, projectId },
        "[POST /projects/:id/ingest/build-artifact] Unhandled error"
      );
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
  }
);

export { router as ingestRouter };
