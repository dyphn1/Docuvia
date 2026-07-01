import { logger } from "@workspace/core";
import { db } from "@workspace/db";
import {
  correctionExamplesTable,
  promptTemplatesTable,
  l3NodesTable,
  l2NodesTable,
  projectsTable,
} from "@workspace/db";
import { isNull, inArray, and, eq, lt } from "drizzle-orm";
import { getLlmClientForProject, checkCommitInDefaultBranch, parseGithubRepo } from "@workspace/core";

export class MetabolismService {
  public async runAll(): Promise<void> {
    logger.info("Metabolism tick started. Running background tasks...");
    await this.processPendingL3Nodes();
    await this.distillPendingCorrections();
    logger.info("Metabolism tick completed.");
  }

  public async processPendingL3Nodes(): Promise<void> {
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
  }

  public async distillPendingCorrections(): Promise<void> {
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

      const promptsToInsert: Array<typeof promptTemplatesTable.$inferInsert> = [];
      const processedIds: number[] = [];

      for (const correction of pendingCorrections) {
        try {
          const { client, model } = await getLlmClientForProject(correction.projectId as number);
          const response = await client.chat.completions.create({
            model,
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
  }
}
