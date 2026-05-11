import { Router } from "express";
import { db } from "@workspace/db";
import { commitsTable, documentsTable, projectsTable, activityLogTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const GitIngestSchema = z.object({
  repoUrl: z.string().optional(),
  branch: z.string().optional().default("main"),
  limit: z.number().optional().default(100),
  githubToken: z.string().optional(),
});

const DocumentIngestSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
  docType: z.enum(["markdown", "txt", "pdf", "docx", "pptx", "build_artifact"]).optional().default("markdown"),
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
  const repoUrl = body.repoUrl ?? project.repoUrl;

  const githubMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!githubMatch) {
    return res.status(400).json({ error: "Only GitHub URLs are supported for Git ingestion. Format: https://github.com/owner/repo" });
  }

  const [, owner, repo] = githubMatch;
  const branch = body.branch ?? "main";
  const limit = Math.min(body.limit ?? 100, 500);
  const perPage = Math.min(limit, 100);
  const pages = Math.ceil(limit / perPage);

  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (body.githubToken) headers["Authorization"] = `Bearer ${body.githubToken}`;

  let allCommits: Array<{ sha: string; commit: { message: string; author: { name: string; date: string } } }> = [];
  for (let page = 1; page <= pages && allCommits.length < limit; page++) {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${perPage}&page=${page}`;
    const ghRes = await fetch(url, { headers });
    if (!ghRes.ok) {
      const err = await ghRes.json().catch(() => ({}));
      return res.status(400).json({ error: `GitHub API error: ${(err as any).message ?? ghRes.statusText}` });
    }
    const data = await ghRes.json() as typeof allCommits;
    if (!data.length) break;
    allCommits.push(...data);
  }
  allCommits = allCommits.slice(0, limit);

  const existingHashes = new Set(
    (await db.select({ hash: commitsTable.hash }).from(commitsTable).where(eq(commitsTable.projectId, projectId)))
      .map(r => r.hash)
  );

  let ingested = 0;
  let skipped = 0;
  for (const c of allCommits) {
    if (existingHashes.has(c.sha)) { skipped++; continue; }
    const score = scoreCommit(c.commit.message);
    await db.insert(commitsTable).values({
      projectId,
      hash: c.sha,
      message: c.commit.message.split("\n")[0].trim(),
      author: c.commit.author?.name ?? "Unknown",
      valid: score >= 0.4,
    });
    ingested++;
  }

  if (ingested > 0) {
    await db.insert(activityLogTable).values({
      type: "commit",
      description: `Ingested ${ingested} commits from ${owner}/${repo}`,
      projectId,
    });
    await db.update(projectsTable).set({ updatedAt: new Date() }).where(eq(projectsTable.id, projectId));
  }

  res.json({ commitsIngested: ingested, commitsSkipped: skipped, totalFetched: allCommits.length });
});

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

  const [doc] = await db.insert(documentsTable).values({
    projectId,
    filename: body.filename,
    docType,
    content: body.content,
  }).returning();

  res.status(201).json({ ...doc, createdAt: doc.createdAt.toISOString() });
});

router.get("/projects/:id/documents", async (req, res) => {
  const projectId = Number(req.params.id);
  const docs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, projectId))
    .orderBy(sql`${documentsTable.createdAt} desc`);
  res.json(docs.map(d => ({ ...d, createdAt: d.createdAt.toISOString() })));
});

export default router;
