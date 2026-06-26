import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@workspace/db";
import { l1TagsTable, l2NodesTable, l3NodesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function buildL1TagsYaml(tagNames: string[]): string {
  if (tagNames.length === 0) return "tags: []\n";
  const lines = tagNames.map((n) => `  - ${n}`).join("\n");
  return `tags:\n${lines}\n`;
}

function buildL2ModuleYaml(node: {
  id: number;
  name: string;
  type: string;
  description: string | null;
  pathPatterns: unknown;
  isBootstrapConfirmed: boolean;
}): string {
  const patterns = Array.isArray(node.pathPatterns) ? (node.pathPatterns as string[]) : [];
  const patternsYaml =
    patterns.length > 0
      ? `path_patterns:\n${patterns.map((p) => `  - "${p}"`).join("\n")}\n`
      : "path_patterns: []\n";
  return (
    [
      `id: ${node.id}`,
      `name: "${node.name}"`,
      `type: ${node.type}`,
      `description: "${(node.description ?? "").replace(/"/g, '\\"')}"`,
      `bootstrap_confirmed: ${node.isBootstrapConfirmed}`,
      patternsYaml.trimEnd(),
    ].join("\n") + "\n"
  );
}

function buildL3DecisionMd(node: {
  id: number;
  title: string;
  content: string | null;
  nodeType: string;
  validityStatus: string;
  occurrenceCount: number;
  commitHash: string | null;
}): string {
  return [
    "---",
    `id: ${node.id}`,
    `title: "${node.title.replace(/"/g, '\\"')}"`,
    `type: ${node.nodeType}`,
    `status: ${node.validityStatus}`,
    `occurrence_count: ${node.occurrenceCount}`,
    `commit_hash: ${node.commitHash ?? "null"}`,
    "---",
    "",
    node.content ?? "",
    "",
  ].join("\n");
}

export async function writeKnowledgeToOrphanBranch(projectId: number): Promise<void> {
  // Use a distributed lock via Postgres to prevent split-brain on identical project pushes
  const lockAcquired = (await db.execute(
    sql`SELECT pg_try_advisory_xact_lock(${projectId}) as acquired`
  )) as any;

  const acquired = lockAcquired.rows ? lockAcquired.rows[0]?.acquired : lockAcquired[0]?.acquired;
  if (!acquired) {
    logger.warn(
      { projectId },
      "[orphan-branch-writer] Lock busy, skipping this sync cycle to prevent split-brain"
    );
    return;
  }

  try {
    const l2Nodes = await db
      .select()
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId));

    if (l2Nodes.length === 0) {
      logger.info(
        { projectId },
        "[orphan-branch-writer] No L2 nodes, skipping orphan branch write"
      );
      return;
    }

    // Verify git is available
    try {
      await execFileAsync("git", ["--version"]);
    } catch {
      logger.warn({ projectId }, "[orphan-branch-writer] git CLI not available, skipping");
      return;
    }

    const baseDir = `${projectId}`;
    const l1TagRows = await db.select({ name: l1TagsTable.name }).from(l1TagsTable);
    const l1TagsYaml = buildL1TagsYaml(l1TagRows.map((t) => t.name));
    const files: Map<string, string> = new Map();
    files.set(`${baseDir}/l1_tags.yaml`, l1TagsYaml);

    for (const l2 of l2Nodes) {
      const l2Slug = slugify(l2.name);
      files.set(`${baseDir}/l2_modules/${l2Slug}.yaml`, buildL2ModuleYaml(l2));

      const l3Nodes = await db.select().from(l3NodesTable).where(eq(l3NodesTable.l2NodeId, l2.id));

      for (const l3 of l3Nodes) {
        const l3Slug = slugify(l3.title);
        const filename = `${l3.id}-${l3Slug}.md`;
        files.set(`${baseDir}/l3_decisions/${filename}`, buildL3DecisionMd(l3));
      }
    }

    const branch = "docuvia-knowledge";
    const now = Math.floor(Date.now() / 1000);
    const fastImportData = buildFastImportData(branch, files, projectId, now);

    // Using git fast-import. In a full Git-Isomorphic setup, we would run git fetch/merge
    // to handle 3-way merges if the client pushed to remote. But for the server-authoritative
    // push, fast-import safely overwrites the tree for the given branch.
    await runGitFastImport(fastImportData);

    logger.info(
      { projectId, branch, fileCount: files.size },
      "[orphan-branch-writer] committed knowledge to orphan branch safely under mutex"
    );
  } catch (err) {
    logger.error({ err, projectId }, "[orphan-branch-writer] failed to write to orphan branch");
  }
}

function buildFastImportData(
  branch: string,
  files: Map<string, string>,
  projectId: number,
  nowUnix: number
): string {
  const lines: string[] = [];
  lines.push(`commit refs/heads/${branch}`);
  lines.push(`committer Docuvia <docuvia@localhost> ${nowUnix} +0000`);
  const msg = `chore: update knowledge snapshot for project ${projectId}`;
  lines.push(`data ${Buffer.byteLength(msg, "utf8")}`);
  lines.push(msg);

  // Delete and recreate project subtree (replace all files for this project)
  lines.push(`deleteall`);

  for (const [filePath, content] of files) {
    const contentBytes = Buffer.from(content, "utf8");
    lines.push(`M 100644 inline ${filePath}`);
    lines.push(`data ${contentBytes.length}`);
    lines.push(content);
  }

  lines.push("");
  return lines.join("\n");
}

function runGitFastImport(fastImportData: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["fast-import", "--quiet"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(`git fast-import exited with code ${code}${stderr ? ": " + stderr : ""}`));
    });
    child.stdin.end(fastImportData, "utf8");
  });
}
