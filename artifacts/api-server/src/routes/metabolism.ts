import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import {
  correctionExamplesTable,
  promptTemplatesTable,
  l3NodesTable,
  l2NodesTable,
  projectsTable,
} from "@workspace/db";
import { isNull, inArray, and, eq, lt } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { checkCommitInDefaultBranch, parseGithubRepo } from "../lib/github-client";

// Using a simple in-memory Mutex for this instance
let isMetabolismRunning = false;

const metabolismRouter = Router();

// Internal function to run the maintenance tasks
async function runMetabolism() {
  logger.info("Metabolism tick started. Running background tasks...");

  // Phase 2 Merge Gate Fallback
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const pendingL3Nodes = await db
    .select({
      id: l3NodesTable.id,
      commitHash: l3NodesTable.commitHash,
      projectId: projectsTable.id,
      repoUrl: projectsTable.repoUrl,
    })
    .from(l3NodesTable)
    .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
    .innerJoin(projectsTable, eq(l2NodesTable.projectId, projectsTable.id))
    .where(
      and(
        eq(l3NodesTable.validityStatus, "pending"),
        lt(l3NodesTable.createdAt, twentyFourHoursAgo)
      )
    );

  if (pendingL3Nodes.length > 0) {
    logger.info(
      { count: pendingL3Nodes.length },
      "Found pending L3 nodes for merge gate fallback."
    );

    const nodesByProject = new Map<number, typeof pendingL3Nodes>();
    for (const node of pendingL3Nodes) {
      const nodes = nodesByProject.get(node.projectId) || [];
      nodes.push(node);
      nodesByProject.set(node.projectId, nodes);
    }

    const validL3Ids: number[] = [];

    for (const [projectId, nodes] of nodesByProject.entries()) {
      const repoUrl = nodes[0].repoUrl;
      const repo = parseGithubRepo(repoUrl);
      if (!repo) continue;

      const token = process.env.GITHUB_TOKEN;

      for (const node of nodes) {
        let isMerged = false;
        const commits = node.commitHash ? [node.commitHash] : [];
        if (commits.length === 0) continue;

        for (const commit of commits) {
          try {
            const merged = await checkCommitInDefaultBranch(repo.owner, repo.repo, commit, token);
            if (merged) {
              isMerged = true;
              break;
            }
          } catch (err) {
            logger.error({ err, commit }, "Failed to check commit in default branch");
          }
        }

        if (isMerged) {
          validL3Ids.push(node.id);
        }
      }
    }

    if (validL3Ids.length > 0) {
      await db
        .update(l3NodesTable)
        .set({ validityStatus: "valid" })
        .where(inArray(l3NodesTable.id, validL3Ids));
      logger.info({ count: validL3Ids.length }, "Promoted pending L3 nodes to valid status.");
    }
  }

  // Distillation Job
  const pendingCorrections = await db
    .select()
    .from(correctionExamplesTable)
    .where(isNull(correctionExamplesTable.processedAt))
    .limit(10);

  if (pendingCorrections.length > 0) {
    logger.info(
      { count: pendingCorrections.length },
      "Found pending corrections for distillation."
    );

    const promptsToInsert: any[] = [];
    const processedIds: number[] = [];

    for (const correction of pendingCorrections) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are an expert software architect. Analyze the human correction (original vs corrected content) and extract a concise, single-sentence architectural guardrail/rule that explains the change.",
            },
            {
              role: "user",
              content: `Original Content:\n${correction.originalContent}\n\nCorrected Content:\n${correction.correctedContent}`,
            },
          ],
          max_tokens: 100,
        });

        const guardrail = response.choices[0]?.message?.content?.trim();

        if (guardrail) {
          promptsToInsert.push({
            projectId: correction.projectId,
            templateType: "l3_generator" as const,
            systemPrompt: guardrail,
            isActive: true,
          });
        }
        processedIds.push(correction.id);
      } catch (err) {
        logger.error({ err, correctionId: correction.id }, "Failed to distill correction");
      }
    }

    if (promptsToInsert.length > 0) {
      await db.insert(promptTemplatesTable).values(promptsToInsert);
    }

    if (processedIds.length > 0) {
      await db
        .update(correctionExamplesTable)
        .set({ processedAt: new Date() })
        .where(inArray(correctionExamplesTable.id, processedIds));
    }
  }

  logger.info("Metabolism tick completed.");
}

metabolismRouter.get("/metabolism-tick", async (req: Request, res: Response): Promise<void> => {
  if (isMetabolismRunning) {
    res.status(202).json({ message: "Metabolism is already running", status: "accepted" });
    return;
  }

  isMetabolismRunning = true;
  try {
    await runMetabolism();
    res.status(200).json({ message: "Metabolism tick completed", status: "success" });
  } catch (err) {
    logger.error({ err }, "Metabolism tick failed");
    res.status(500).json({ error: "Metabolism tick failed" });
  } finally {
    isMetabolismRunning = false;
  }
});

metabolismRouter.get(
  "/admin/metabolism-tick",
  async (req: Request, res: Response): Promise<void> => {
    let adminSecret = process.env.ADMIN_SECRET_TOKEN;

    if (!adminSecret) {
      if (process.env.NODE_ENV === "development") {
        adminSecret = "dev-secret-token";
      } else {
        logger.error("ADMIN_SECRET_TOKEN is missing. Server misconfigured. Failing closed.");
        res.status(500).json({ error: "Server misconfiguration" });
        return;
      }
    }

    let token = req.query.admin_token as string | undefined;

    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.substring(7);
    }

    if (!token || token !== adminSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (isMetabolismRunning) {
      res.status(202).json({ message: "Metabolism is already running", status: "accepted" });
      return;
    }

    isMetabolismRunning = true;
    try {
      await runMetabolism();
      res.status(200).json({ message: "Metabolism tick completed manually", status: "success" });
    } catch (err) {
      logger.error({ err }, "Admin metabolism tick failed");
      res.status(500).json({ error: "Metabolism tick failed" });
    } finally {
      isMetabolismRunning = false;
    }
  }
);

export { metabolismRouter };
