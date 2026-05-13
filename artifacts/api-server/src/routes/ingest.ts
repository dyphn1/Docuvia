import { Router } from "express";
import { db } from "@workspace/db";
import { commitsTable, documentsTable, projectsTable, activityLogTable } from "@workspace/db";
import { and, eq, sql, isNull } from "drizzle-orm";
import { getSvnLog, getSvnDiff } from "../lib/svn-client.js";
import { IngestSvnBody } from "@workspace/api-zod";
import { z } from "zod";
import { documentUpload } from "../middlewares/upload.js";
import { detectDocType, extractText } from "../lib/document-parser.js";
import multer from "multer";

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

const DocumentIngestSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
  docType: z
    .enum(["markdown", "txt", "pdf", "docx", "pptx", "build_artifact"])
    .optional()
    .default("markdown"),
});

function scoreCommit(message: string): number {
  const msg = message.toLowerCase();
  const noisePatterns = [
    /^merge (pull request|branch)/i,
    /^bump version/i,
    /^chore:/i,
    /^auto-generated/i,
    /^ci:/i,
    /^wip:/i,
    /^revert /i,
    /^initial commit/i,
    /^update changelog/i,
    /^\[skip ci\]/i,
  ];
  for (const p of noisePatterns) {
    if (p.test(msg)) return 0.1;
  }
  const signalPatterns = [
    /\bfix(ed|es|ing)?\b/i,
    /\bfeat(ure)?\b/i,
    /\badd(ed|s|ing)?\b/i,
    /\brefactor/i,
    /\bimplements?\b/i,
    /\bresolves?\b/i,
    /\bbreaking change\b/i,
    /\bdecision\b/i,
    /\barchitecture\b/i,
    /\bperformance\b/i,
  ];
  let score = 0.3;
  for (const p of signalPatterns) {
    if (p.test(msg)) score += 0.15;
  }
  if (message.length > 50) score += 0.1;
  return Math.min(score, 1.0);
}

router.post("/projects/:id/ingest/git", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const body = GitIngestSchema.parse(req.body);
  const mode = body.mode ?? "full";
  const repoUrl = body.repoUrl ?? project.repoUrl;

  const githubMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!githubMatch) {
    return res.status(400).json({
      error:
        "Only GitHub URLs are supported for Git ingestion. Format: https://github.com/owner/repo",
    });
  }

  const [, owner, repo] = githubMatch;
  const branch = body.branch ?? "main";
  const limit = Math.min(body.limit ?? 100, 500);
  const perPage = Math.min(limit, 100);
  const pages = Math.ceil(limit / perPage);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = body.githubToken ?? process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let allCommits: Array<{
    sha: string;
    commit: { message: string; author: { name: string; date: string } };
  }> = [];
  for (let page = 1; page <= pages && allCommits.length < limit; page++) {
    const sinceParam =
      mode === "incremental" && project.lastGitIngestedAt
        ? `&since=${project.lastGitIngestedAt.toISOString()}`
        : "";
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${perPage}&page=${page}${sinceParam}`;
    const ghRes = await fetch(url, { headers });
    if (!ghRes.ok) {
      const err = await ghRes.json().catch(() => ({}));
      return res
        .status(400)
        .json({ error: `GitHub API error: ${(err as any).message ?? ghRes.statusText}` });
    }
    const data = (await ghRes.json()) as typeof allCommits;
    if (!data.length) break;
    allCommits.push(...data);
  }
  allCommits = allCommits.slice(0, limit);

  const existingHashes = new Set(
    (
      await db
        .select({ hash: commitsTable.hash })
        .from(commitsTable)
        .where(eq(commitsTable.projectId, projectId))
    ).map((r) => r.hash)
  );

  let ingested = 0;
  let skipped = 0;
  let newestCommitDate: Date | null = null;
  for (const c of allCommits) {
    if (existingHashes.has(c.sha)) {
      skipped++;
      continue;
    }
    const score = scoreCommit(c.commit.message);
    await db.insert(commitsTable).values({
      projectId,
      hash: c.sha,
      message: c.commit.message.split("\n")[0].trim(),
      author: c.commit.author?.name ?? "Unknown",
      valid: score >= 0.4,
    });
    const commitDate = new Date(c.commit.author?.date ?? "");
    if (!isNaN(commitDate.getTime()) && (!newestCommitDate || commitDate > newestCommitDate)) {
      newestCommitDate = commitDate;
    }
    ingested++;
  }

  if (ingested > 0) {
    await db.insert(activityLogTable).values({
      type: "commit",
      description: `Ingested ${ingested} commits from ${owner}/${repo}`,
      projectId,
    });
    await db
      .update(projectsTable)
      .set({ updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));
  }

  if (mode === "incremental") {
    const newCursor = newestCommitDate ?? new Date();
    await db
      .update(projectsTable)
      .set({ lastGitIngestedAt: newCursor })
      .where(eq(projectsTable.id, projectId));
  }

  return res.json({
    commitsIngested: ingested,
    commitsSkipped: skipped,
    totalFetched: allCommits.length,
  });
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
  let startRevision = body.startRevision ?? 1;
  const endRevision = body.endRevision ?? "HEAD";

  if (svnMode === "incremental" && project.lastSvnRevision != null) {
    startRevision = project.lastSvnRevision + 1;
  }

  let revisions;
  try {
    revisions = await getSvnLog(svnUrl, startRevision, endRevision, body.username, body.password);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `Failed to fetch SVN log: ${msg}` });
  }

  let ingested = 0;
  let skipped = 0;
  const errors: string[] = [];
  let maxRevisionIngested = project.lastSvnRevision ?? 0;

  for (const rev of revisions) {
    const [existing] = await db
      .select({ id: commitsTable.id })
      .from(commitsTable)
      .where(
        and(
          eq(commitsTable.projectId, projectId),
          eq(commitsTable.vcsType, "svn"),
          eq(commitsTable.revision, rev.revision)
        )
      );

    if (existing) {
      skipped++;
      continue;
    }

    let diff = "";
    try {
      diff = await getSvnDiff(svnUrl, rev.revision, body.username, body.password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`r${rev.revision}: ${msg}`);
    }

    const score = scoreCommit(rev.message);
    const firstLine = rev.message.split("\n")[0].trim();
    const fullMessage = diff ? `${firstLine}\n\n${diff}` : firstLine;

    await db.insert(commitsTable).values({
      projectId,
      hash: `svn:R${rev.revision}`,
      message: fullMessage.slice(0, 4000),
      author: rev.author,
      valid: score >= 0.4,
      revision: rev.revision,
      vcsType: "svn",
    });
    if (rev.revision > maxRevisionIngested) maxRevisionIngested = rev.revision;
    ingested++;
  }

  if (ingested > 0) {
    await db.insert(activityLogTable).values({
      type: "commit",
      description: `Ingested ${ingested} SVN revisions from ${svnUrl}`,
      projectId,
    });
    await db
      .update(projectsTable)
      .set({ updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));
  }

  if (svnMode === "incremental" && maxRevisionIngested > (project.lastSvnRevision ?? 0)) {
    await db
      .update(projectsTable)
      .set({ lastSvnRevision: maxRevisionIngested })
      .where(eq(projectsTable.id, projectId));
  }

  return res.json({ ingested, skipped, errors });
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
    const docType = detectDocType(originalname);

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

    const [doc] = await db
      .insert(documentsTable)
      .values({
        projectId,
        filename: originalname,
        docType,
        content,
      })
      .returning();

    return res.status(201).json({ ...doc, createdAt: doc.createdAt.toISOString() });
  }
);

router.post("/projects/:id/ingest/document", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const body = DocumentIngestSchema.parse(req.body);

  const ext = body.filename.split(".").pop()?.toLowerCase() ?? "md";
  let docType: "markdown" | "txt" | "pdf" | "docx" | "pptx" | "build_artifact" = "markdown";
  if (ext === "txt") docType = "txt";
  else if (ext === "pdf") docType = "pdf";
  else if (ext === "docx") docType = "docx";
  else if (ext === "pptx") docType = "pptx";
  else if (["map", "fv", "fd"].includes(ext)) docType = "build_artifact";
  if (body.docType) docType = body.docType;

  const [doc] = await db
    .insert(documentsTable)
    .values({
      projectId,
      filename: body.filename,
      docType,
      content: body.content,
    })
    .returning();

  return res.status(201).json({ ...doc, createdAt: doc.createdAt.toISOString() });
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

// Handle multer errors (file too large, unsupported type)
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

export default router;
