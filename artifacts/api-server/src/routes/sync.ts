import { Router } from "express";
import { db } from "@workspace/db";
import {
  commitsTable,
  l3NodesTable,
  l2NodesTable,
  llmConfigsTable,
  commitL2LinksTable,
  projectsTable,
} from "@workspace/db";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { writeKnowledgeToOrphanBranch } from "../lib/orphan-branch-writer.js";

const router = Router();

const SyncBodySchema = z.object({
  projectId: z.number().int().positive(),
  pushedBranch: z.string().min(1),
  pushedCommits: z.array(z.string()),
  configYaml: z.string().optional(),
});

/**
 * Parse a flat YAML string into a key-value record.
 * Supports string, number, and boolean values for top-level keys only.
 */
function parseSimpleYaml(yaml: string): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const line of yaml.split("\n")) {
    const match = line.match(/^(\w+):\s*(.+?)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (raw === "true") result[key] = true;
    else if (raw === "false") result[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) result[key] = parseFloat(raw);
    else result[key] = raw.replace(/^["']|["']$/g, "");
  }
  return result;
}

const DEFAULT_BRANCHES = new Set(["main", "master", "trunk"]);

function isMainBranch(branch: string): boolean {
  return DEFAULT_BRANCHES.has(branch.toLowerCase());
}

router.post("/sync", async (req, res) => {
  const parsed = SyncBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
  }

  const { projectId, pushedBranch, pushedCommits, configYaml } = parsed.data;

  // Verify project exists
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  // 1. Upsert llm_configs fields from configYaml
  if (configYaml) {
    const cfg = parseSimpleYaml(configYaml);

    const patchFields: {
      model?: string;
      similarityThreshold?: number;
      condensationThreshold?: number;
      condensationReviewRequired?: boolean;
      autoGenerate?: boolean;
      maxCommitsPerRun?: number;
      cooldownMinutes?: number;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (typeof cfg["model"] === "string") patchFields.model = cfg["model"];
    if (typeof cfg["similarityThreshold"] === "number")
      patchFields.similarityThreshold = cfg["similarityThreshold"];
    if (typeof cfg["condensationThreshold"] === "number")
      patchFields.condensationThreshold = cfg["condensationThreshold"];
    if (typeof cfg["condensationReviewRequired"] === "boolean")
      patchFields.condensationReviewRequired = cfg["condensationReviewRequired"];
    if (typeof cfg["autoGenerate"] === "boolean") patchFields.autoGenerate = cfg["autoGenerate"];
    if (typeof cfg["maxCommitsPerRun"] === "number")
      patchFields.maxCommitsPerRun = cfg["maxCommitsPerRun"];
    if (typeof cfg["cooldownMinutes"] === "number")
      patchFields.cooldownMinutes = cfg["cooldownMinutes"];

    const [existingCfg] = await db
      .select()
      .from(llmConfigsTable)
      .where(eq(llmConfigsTable.projectId, projectId));

    if (existingCfg) {
      await db
        .update(llmConfigsTable)
        .set(patchFields)
        .where(eq(llmConfigsTable.id, existingCfg.id));
    } else {
      await db.insert(llmConfigsTable).values({
        projectId,
        provider: typeof cfg["provider"] === "string" ? cfg["provider"] : "openai",
        model: typeof cfg["model"] === "string" ? cfg["model"] : "gpt-5.2",
        ...patchFields,
      });
    }
    logger.info({ projectId }, "[sync] llm_configs upserted from configYaml");
  }

  // 2. Update commits.branchName for pushed commits
  if (pushedCommits.length > 0) {
    await db
      .update(commitsTable)
      .set({ branchName: pushedBranch })
      .where(
        and(
          eq(commitsTable.projectId, projectId),
          inArray(commitsTable.hash, pushedCommits)
        )
      );

    // 3. If branch is main/default: promote commit and L3 validity to 'valid'
    if (isMainBranch(pushedBranch)) {
      await db
        .update(commitsTable)
        .set({ validityStatus: "valid" })
        .where(
          and(
            eq(commitsTable.projectId, projectId),
            inArray(commitsTable.hash, pushedCommits)
          )
        );

      // Cascade: find L3 nodes linked to these commits via commit_l2_links or direct commitHash
      const linkedCommits = await db
        .select({ id: commitsTable.id })
        .from(commitsTable)
        .where(
          and(
            eq(commitsTable.projectId, projectId),
            inArray(commitsTable.hash, pushedCommits)
          )
        );

      if (linkedCommits.length > 0) {
        const commitIds = linkedCommits.map((c) => c.id);

        // Find L2 nodes linked via commit_l2_links
        const commitL2Links = await db
          .select({ l2NodeId: commitL2LinksTable.l2NodeId })
          .from(commitL2LinksTable)
          .where(inArray(commitL2LinksTable.commitId, commitIds));

        if (commitL2Links.length > 0) {
          const l2NodeIds = [...new Set(commitL2Links.map((l) => l.l2NodeId))];
          // Promote L3 nodes under these L2 nodes that have matching sourceCommits
          const l3Nodes = await db
            .select({ id: l3NodesTable.id, sourceCommits: l3NodesTable.sourceCommits })
            .from(l3NodesTable)
            .where(
              and(inArray(l3NodesTable.l2NodeId, l2NodeIds), isNotNull(l3NodesTable.id))
            );

          const validL3Ids = l3Nodes
            .filter((n) => {
              const sources = Array.isArray(n.sourceCommits)
                ? (n.sourceCommits as string[])
                : [];
              return sources.some((h) => pushedCommits.includes(h));
            })
            .map((n) => n.id);

          if (validL3Ids.length > 0) {
            await db
              .update(l3NodesTable)
              .set({ validityStatus: "valid" })
              .where(inArray(l3NodesTable.id, validL3Ids));
          }
        }

        // Also cascade via direct commitHash field (legacy)
        await db
          .update(l3NodesTable)
          .set({ validityStatus: "valid" })
          .where(
            and(
              inArray(l3NodesTable.commitHash, pushedCommits),
              isNotNull(l3NodesTable.commitHash)
            )
          );
      }

      logger.info(
        { projectId, pushedBranch, commitCount: pushedCommits.length },
        "[sync] promoted commits and L3 nodes to valid"
      );
    }

    // 4. Auto-generate check (enqueue deferred — actual queue implementation is deferred per plan)
    const [currentCfg] = await db
      .select()
      .from(llmConfigsTable)
      .where(eq(llmConfigsTable.projectId, projectId));

    if (currentCfg?.autoGenerate) {
      // Cooldown check: compare lastGitIngestedAt or updatedAt against cooldownMinutes
      const cooldownMs = (currentCfg.cooldownMinutes ?? 60) * 60 * 1000;
      const lastRun = currentCfg.updatedAt;
      const elapsed = Date.now() - lastRun.getTime();

      if (elapsed >= cooldownMs) {
        logger.info(
          { projectId, cooldownMinutes: currentCfg.cooldownMinutes },
          "[sync] enqueue generate — autoGenerate enabled and cooldown passed"
        );
      } else {
        logger.info(
          { projectId, remainingMs: cooldownMs - elapsed },
          "[sync] autoGenerate skipped — cooldown not yet passed"
        );
      }
    }
  }

  // 5. Write updated knowledge to orphan branch (fire-and-forget)
  writeKnowledgeToOrphanBranch(projectId).catch((err) => {
    logger.warn({ err, projectId }, "[sync] orphan branch write failed (non-fatal)");
  });

  return res.json({
    ok: true,
    projectId,
    pushedBranch,
    commitsProcessed: pushedCommits.length,
    mainBranchPromotion: isMainBranch(pushedBranch),
  });
});

export default router;
