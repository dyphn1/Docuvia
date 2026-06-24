import { Router } from "express";
import { db } from "@workspace/db";
import fs from "fs";
import { computeHashFromStream } from "../lib/utils/hash.js";
import { commitsTable, documentsTable, projectsTable } from "@workspace/db";
import { and, eq, sql, isNull } from "drizzle-orm";
import { getSvnLog, getSvnDiff } from "../lib/svn-client.js";
import { IngestSvnBody, IngestDocumentBody } from "@workspace/api-zod";
import { z } from "zod";
import { documentUpload } from "../middlewares/upload.js";
import { detectDocType, extractText } from "../lib/document-parser.js";
import multer from "multer";
import { LocalGitClient, GitCommitData } from "../lib/git-client.js";
import {
  processIngestion,
  GitCommitItem,
  SvnCommitItem,
  DocumentItem,
} from "../lib/ingestion-pipeline.js";
import { ingestAstJsonl, ingestAstBatch } from "../lib/ast-ingestion-pipeline.js";
import { logger } from "../lib/logger.js";

const router = Router();

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

router.post("/projects/:id/ingest/git", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const body = GitIngestSchema.parse(req.body);
  const mode = body.mode ?? "full";
  const repoUrl = body.repoUrl ?? project.repoUrl;
  const branch = body.branch ?? "main";
  const limit = Math.min(body.limit ?? 100, 500);

  if (!repoUrl) {
    return res.status(400).json({ error: "repoUrl is required" });
  }

  const client = new LocalGitClient(repoUrl);
  try {
    await client.clone(branch);

    const since =
      mode === "incremental" && project.lastGitIngestedAt ? project.lastGitIngestedAt : undefined;
    const commits = await client.getCommits(limit, since);

    const gitItems: GitCommitItem[] = [];
    let newestCommitDate: Date | null = null;

    for (const c of commits) {
      const diff = await client.getDiff(c.sha);
      gitItems.push({
        ...c,
        diff,
      });

      const commitDate = new Date(c.date ?? "");
      if (!isNaN(commitDate.getTime()) && (!newestCommitDate || commitDate > newestCommitDate)) {
        newestCommitDate = commitDate;
      }
    }

    const { ingested, skipped, errors } = await processIngestion({
      type: "git",
      projectId,
      projectName: project.name,
      items: gitItems,
    });

    if (mode === "incremental" && newestCommitDate) {
      await db
        .update(projectsTable)
        .set({ lastGitIngestedAt: newestCommitDate })
        .where(eq(projectsTable.id, projectId));
    }

    return res.json({
      commitsIngested: ingested,
      commitsSkipped: skipped,
      totalFetched: gitItems.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    logger.error({ err }, "Git ingestion failed");
    return res.status(500).json({ error: `Git ingestion failed: ${err.message}` });
  } finally {
    await client.cleanup();
  }
});

router.post("/projects/:id/ingest/svn", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  let body: ReturnType<typeof IngestSvnBody.parse>;
  try {
    body = IngestSvnBody.parse(req.body);
  } catch (err) {
    return res.status(400).json({ error: "Invalid request body", details: err });
  }

  const { mode: svnMode } = SvnModeSchema.parse(req.body);
  const svnUrl = body.svnUrl;

  // Strict URL Validation for SVN
  if (!/^https?:\/\/|^svn:\/\//.test(svnUrl)) {
    return res.status(400).json({ error: "Invalid SVN URL format" });
  }

  let startRevision = body.startRevision ?? 1;
  const endRevision = body.endRevision ?? "HEAD";

  if (svnMode === "incremental" && project.lastSvnRevision != null) {
    startRevision = project.lastSvnRevision + 1;
  }

  let maxRevisionIngested = project.lastSvnRevision ?? 0;
  let totalIngested = 0;
  let totalSkipped = 0;
  const svnErrors: string[] = [];
  const ingestErrors: string[] = [];

  try {
    const logGenerator = getSvnLog(
      svnUrl,
      startRevision,
      endRevision,
      body.username,
      body.password
    );
    let batch: SvnCommitItem[] = [];

    const flushBatch = async () => {
      if (batch.length === 0) return;
      const { ingested, skipped, errors } = await processIngestion({
        type: "svn",
        projectId,
        projectName: project.name,
        items: batch,
      });
      totalIngested += ingested;
      totalSkipped += skipped;
      ingestErrors.push(...errors);
      batch = [];
    };

    for await (const rev of logGenerator) {
      let diff = "";
      try {
        diff = await getSvnDiff(svnUrl, rev.revision, body.username, body.password);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        svnErrors.push(`r${rev.revision}: ${msg}`);
      }

      batch.push({
        revision: rev.revision,
        message: rev.message,
        author: rev.author,
        diff,
      });

      if (rev.revision > maxRevisionIngested) maxRevisionIngested = rev.revision;

      if (batch.length >= 50) {
        await flushBatch();
      }
    }

    await flushBatch();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `Failed to fetch SVN log: ${msg}` });
  }

  if (svnMode === "incremental" && maxRevisionIngested > (project.lastSvnRevision ?? 0)) {
    await db
      .update(projectsTable)
      .set({ lastSvnRevision: maxRevisionIngested })
      .where(eq(projectsTable.id, projectId));
  }

  return res.json({
    ingested: totalIngested,
    skipped: totalSkipped,
    errors: [...svnErrors, ...ingestErrors],
  });
});

router.get("/projects/:id/ingest/status", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const [{ pendingCount }] = await db
    .select({ pendingCount: sql<number>`count(*)::int` })
    .from(commitsTable)
    .where(and(eq(commitsTable.projectId, projectId), isNull(commitsTable.processedAt)));

  return res.json({
    projectId: project.id,
    vcsType: project.vcsType,
    lastGitIngestedAt: project.lastGitIngestedAt?.toISOString() ?? null,
    lastSvnRevision: project.lastSvnRevision ?? null,
    pendingCommits: Number(pendingCount),
  });
});

router.post(
  "/projects/:id/ingest/document/upload",
  documentUpload.single("file"),
  async (req, res, next) => {
    const projectId = Number(req.params.id);
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (!req.file) {
      return res
        .status(400)
        .json({ error: "No file uploaded. Use multipart/form-data with field name 'file'." });
    }

    const { originalname, buffer } = req.file;
    let docType = detectDocType(originalname);

    // Fix extension matching logic to map .log to build_artifact
    const ext = originalname.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "log") docType = "build_artifact";

    let content: string;
    try {
      content = await extractText(buffer, docType, originalname);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(422).json({ error: `Failed to parse document: ${msg}` });
    }

    if (!content || content.length === 0) {
      return res.status(422).json({
        error: "Extracted content is empty. The document may be encrypted or contain only images.",
      });
    }

    const docItem: DocumentItem = {
      filename: originalname,
      docType,
      content,
      commitSha: req.body.commitSha as string | undefined, // ensure commitSha is parsed
    };

    const { ingested, skipped, errors } = await processIngestion({
      type: "document",
      projectId,
      projectName: project.name,
      items: [docItem],
    });

    if (errors.length > 0) {
      return res.status(500).json({ error: `Ingestion failed: ${errors.join(", ")}` });
    }

    if (skipped > 0) {
      return res.status(409).json({ error: "Document already exists" });
    }

    const docs = await db
      .select()
      .from(documentsTable)
      .where(
        and(eq(documentsTable.projectId, projectId), eq(documentsTable.filename, originalname))
      )
      .orderBy(sql`${documentsTable.createdAt} desc`)
      .limit(1);

    return res.status(201).json({ ...docs[0], createdAt: docs[0].createdAt.toISOString() });
  }
);

router.post("/projects/:id/ingest/document", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  let body;
  try {
    body = IngestDocumentBody.parse(req.body);
  } catch (err) {
    return res.status(400).json({ error: "Invalid request body", details: err });
  }

  const ext = body.filename.split(".").pop()?.toLowerCase() ?? "md";
  let docType: "markdown" | "txt" | "pdf" | "docx" | "pptx" | "build_artifact" = "markdown";
  if (ext === "txt") docType = "txt";
  else if (ext === "pdf") docType = "pdf";
  else if (ext === "docx") docType = "docx";
  else if (ext === "pptx") docType = "pptx";
  else if (["map", "fv", "fd", "log"].includes(ext)) docType = "build_artifact"; // log handled
  if (body.docType) docType = body.docType as any;

  const docItem: DocumentItem = {
    filename: body.filename,
    docType,
    content: body.content,
    commitSha: body.commitSha ?? undefined,
  };

  const { ingested, skipped, errors } = await processIngestion({
    type: "document",
    projectId,
    projectName: project.name,
    items: [docItem],
  });

  if (errors.length > 0) {
    return res.status(500).json({ error: `Ingestion failed: ${errors.join(", ")}` });
  }

  if (skipped > 0) {
    return res.status(409).json({ error: "Document already exists" });
  }

  const docs = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.filename, body.filename)))
    .orderBy(sql`${documentsTable.createdAt} desc`)
    .limit(1);

  return res.status(201).json({ ...docs[0], createdAt: docs[0].createdAt.toISOString() });
});

router.get("/projects/:id/documents", async (req, res) => {
  const projectId = Number(req.params.id);
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.projectId, projectId))
    .orderBy(sql`${documentsTable.createdAt} desc`);
  res.json(docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })));
});

// POST /projects/:id/ingest/ast
// Ingests AST skeleton (.jsonl) files produced by ast-worker into the knowledge graph.
// Accepts either a single file path or an array of file paths.
const AstIngestSchema = z.object({
  jsonlPaths: z.union([z.string(), z.array(z.string())]).optional(),
  jsonlPath: z.string().optional(),
});

router.post("/projects/:id/ingest/ast", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  try {
    const body = AstIngestSchema.parse(req.body);
    const paths = body.jsonlPaths ?? body.jsonlPath;
    if (!paths) {
      return res.status(400).json({ error: "jsonlPath or jsonlPaths is required" });
    }

    const pathArray = Array.isArray(paths) ? paths : [paths];
    const result = await ingestAstBatch(pathArray, projectId);

    return res.json({
      l2Created: result.l2Created,
      l3Created: result.l3Created,
      linksCreated: result.linksCreated,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (err: any) {
    logger.error({ err, projectId }, "AST ingestion endpoint failed");
    return res.status(500).json({ error: `AST ingestion failed: ${err.message}` });
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

// POST /projects/:id/ingest/build-artifact
router.post(
  "/projects/:id/ingest/build-artifact",
  documentUpload.single("file"),
  async (req, res) => {
    const projectId = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: "file required" });

    try {
      // Basic ANSI strip implementation
      const filePath = req.file.path;
      const contentHash = await computeHashFromStream(filePath);
      const rawContent = await fs.promises.readFile(filePath, "utf-8");
      const strippedContent = rawContent.replace(/\x1b\[[0-9;]*[mG]/g, "");

      const result = await processIngestion({
        type: "document",
        projectId,
        projectName: `Project ${projectId}`, // We should fetch this
        items: [
          {
            filename: req.file.originalname,
            content: strippedContent,
            docType: "build_artifact",
            contentHash,
          },
        ],
      });

      await fs.promises.unlink(filePath).catch(() => {});
      return res.json(result);
    } catch (err) {
      logger.error(
        { err, projectId },
        "[POST /projects/:id/ingest/build-artifact] Unhandled error"
      );
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
