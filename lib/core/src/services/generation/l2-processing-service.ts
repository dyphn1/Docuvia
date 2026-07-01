import { eq, and, sql } from "drizzle-orm";
import {
  l1TagsTable,
  l2NodesTable,
  l2NodeL1TagsTable,
  reviewTasksTable,
  commitsTable,
  commitL2LinksTable,
  activityLogTable,
  subscriptionsTable,
  notificationsTable,
} from "@workspace/db";
import {
  IL2ProcessingService,
  IL3ProcessingService,
  ILlmGenerationService,
  L2NodeAI,
} from "../../interfaces/knowledge-generation.interfaces.js";
import { getPromptTemplate, getRecentCorrections } from "../prompt-service.js";
import { generateEmbedding } from "../embedding.js";
import { detectCrossProjectLinks } from "../cross-project-service.js";
import { LocalGitClient } from "../git-client.js";
import { logger } from "../../utils/logger.js";
import { notifyExternalIntegrations } from "../slack-teams-client.js";

export class L2ProcessingService implements IL2ProcessingService {
  constructor(
    private readonly llmGenerationService: ILlmGenerationService,
    private readonly l3ProcessingService: IL3ProcessingService
  ) {}

  async processL2Nodes(
    tx: any,
    projectId: number,
    project: any,
    validCommits: any[],
    commitData: any[],
    documents: any[],
    documentContext: string,
    tagMap: Map<string, number>,
    model: string,
    similarityThreshold: number,
    condensationThreshold: number,
    condensationReviewRequired: boolean
  ): Promise<{
    l2Created: number;
    l2Updated: number;
    l3Created: number;
    rTasksCreated: number;
    crossLinks: number;
  }> {
    let l2Created = 0;
    let l2Updated = 0;
    let l3Created = 0;
    let rTasksCreated = 0;
    let crossLinks = 0;

    const l2SystemPrompt = await getPromptTemplate(projectId, "l2_extractor");
    const corrections = await getRecentCorrections(projectId, "l2_node");
    const allL1Tags = await tx.select().from(l1TagsTable);

    const commitHashMap = new Map<string, number>();
    for (const c of validCommits) {
      commitHashMap.set(c.hash.slice(0, 8), c.id);
      commitHashMap.set(c.hash, c.id);
    }

    const existingL2 = await tx
      .select()
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId));
    const existingL2Map = new Map<string, (typeof existingL2)[0]>();
    for (const node of existingL2) {
      existingL2Map.set(node.name.toLowerCase(), node);
    }

    const allBootstrapConfirmed =
      existingL2.length > 0 && existingL2.every((n: any) => n.isBootstrapConfirmed);

    let l2Input: L2NodeAI[] = [];

    if (allBootstrapConfirmed) {
      logger.info(
        { projectId },
        "[generate] All L2 nodes bootstrap-confirmed — path-rule mode; assigning L2 based on pathPatterns"
      );

      const gitClient = new LocalGitClient(project.repoUrl);
      await gitClient.clone();

      try {
        const getStaticDepth = (pattern: string): number => {
          let depth = 0;
          for (const part of pattern.split("/")) {
            if (/[*?{}[\]]/.test(part)) break;
            if (part) depth++;
          }
          return depth;
        };

        const getMaxDepth = (patterns: string[]): number => {
          if (!patterns || patterns.length === 0) return 0;
          return Math.max(...patterns.map(getStaticDepth));
        };

        const sortedL2 = [...existingL2].sort(
          (a, b) =>
            getMaxDepth((b.pathPatterns as string[]) || []) -
            getMaxDepth((a.pathPatterns as string[]) || [])
        );

        const globToRegExp = (glob: string): RegExp => {
          const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
          const regexStr = escaped
            .replace(/\\\*\\\*/g, ".*")
            .replace(/\\\*/g, "[^/]*")
            .replace(/\\\?/g, ".");
          return new RegExp(`^${regexStr}$`);
        };

        let sysNode = sortedL2.find((n) => n.type === "sys-uncategorized");
        if (!sysNode) {
          [sysNode] = await tx
            .insert(l2NodesTable)
            .values({
              projectId,
              name: "Uncategorized",
              type: "sys-uncategorized",
              isSystem: true,
              aiGenerated: false,
              description: "System node for uncategorized commits",
              isBootstrapConfirmed: true,
            })
            .returning();
          existingL2.push(sysNode);
        }

        for (const commit of validCommits) {
          const files = await gitClient.getModifiedFiles(commit.hash);
          let assignedL2NodeId: number | null = null;
          let diffPathsForLink: string[] = [];

          for (const file of files) {
            let matched = false;
            for (const node of sortedL2) {
              const patterns = (node.pathPatterns as string[]) || [];
              for (const pattern of patterns) {
                if (globToRegExp(pattern).test(file)) {
                  assignedL2NodeId = node.id;
                  diffPathsForLink.push(file);
                  matched = true;
                  break;
                }
              }
              if (matched) break;
            }
            if (matched) break;
          }

          const targetNodeId = assignedL2NodeId ?? sysNode.id;

          await tx
            .update(commitsTable)
            .set({ l2NodeId: targetNodeId })
            .where(eq(commitsTable.id, commit.id))
            .catch((err: unknown) => logger.warn({ err }, "Ignored error"));

          await tx
            .insert(commitL2LinksTable)
            .values({
              commitId: commit.id,
              l2NodeId: targetNodeId,
            })
            .onConflictDoNothing()
            .catch((err: unknown) => logger.warn({ err }, "Ignored error"));
        }
      } finally {
        await gitClient.cleanup();
      }
    } else {
      const BATCH_SIZE = 20;
      const previousL2Names: string[] = [];

      for (let batchStart = 0; batchStart < commitData.length; batchStart += BATCH_SIZE) {
        const batchCommits = commitData.slice(batchStart, batchStart + BATCH_SIZE);
        const batchResult = await this.llmGenerationService.generateL2Nodes(
          projectId,
          batchCommits,
          allL1Tags,
          documentContext,
          model,
          l2SystemPrompt,
          corrections,
          previousL2Names
        );
        for (const node of batchResult) {
          if (!previousL2Names.includes(node.name)) {
            previousL2Names.push(node.name);
          }
        }
        l2Input = [...l2Input, ...batchResult];
      }
    }

    for (const l2data of l2Input) {
      const nameKey = l2data.name.toLowerCase();
      let l2node: (typeof existingL2)[0];

      if (existingL2Map.has(nameKey)) {
        const existing = existingL2Map.get(nameKey)!;
        const [updated] = await tx
          .update(l2NodesTable)
          .set({
            description: l2data.description,
            type: l2data.type ?? "module",
            aiGenerated: true,
            needsReview: true,
          })
          .where(eq(l2NodesTable.id, existing.id))
          .returning();
        l2node = updated;
        l2Updated++;
      } else {
        const [created] = await tx
          .insert(l2NodesTable)
          .values({
            projectId,
            name: l2data.name,
            type: l2data.type ?? "module",
            description: l2data.description,
            aiGenerated: true,
            needsReview: true,
          })
          .returning();
        l2node = created;
        existingL2Map.set(nameKey, created);
        l2Created++;
      }

      const l2EmbText = `${l2data.name} ${l2data.description ?? ""}`.trim();
      const l2Embedding = await generateEmbedding(projectId, l2EmbText);
      if (l2Embedding) {
        await tx
          .update(l2NodesTable)
          .set({ embedding: l2Embedding })
          .where(eq(l2NodesTable.id, l2node.id));

        await detectCrossProjectLinks(l2node.id, l2Embedding, projectId);
        crossLinks++;
      }

      for (const tagName of l2data.l1TagNames ?? []) {
        const tagId =
          tagMap.get(tagName.toLowerCase()) ??
          allL1Tags.find((t: any) => t.name.toLowerCase() === tagName.toLowerCase())?.id;
        if (tagId) {
          await tx
            .insert(l2NodeL1TagsTable)
            .values({ l2NodeId: l2node.id, l1TagId: tagId })
            .catch((err: unknown) => logger.warn({ err }, "Ignored error"));
          await tx
            .update(l1TagsTable)
            .set({ usageCount: sql`${l1TagsTable.usageCount} + 1` })
            .where(eq(l1TagsTable.id, tagId));
        }
      }

      const { l3Created: l3c, rTasksCreated: rtc } = await this.l3ProcessingService.processL3Nodes(
        tx,
        projectId,
        l2node,
        l2data,
        similarityThreshold,
        condensationThreshold,
        condensationReviewRequired,
        model,
        commitHashMap
      );
      l3Created += l3c;
      rTasksCreated += rtc;
    }

    const postL2 = await tx
      .select()
      .from(l2NodesTable)
      .where(and(eq(l2NodesTable.projectId, projectId), eq(l2NodesTable.needsReview, true)));
    const pendingL2Reviews = await tx
      .select()
      .from(reviewTasksTable)
      .where(
        and(eq(reviewTasksTable.entityType, "l2_node"), eq(reviewTasksTable.status, "pending"))
      );
    const coveredL2Ids = new Set(pendingL2Reviews.map((t: any) => t.entityId));

    for (const node of postL2) {
      if (!coveredL2Ids.has(node.id)) {
        await tx.insert(reviewTasksTable).values({
          entityType: "l2_node",
          entityId: node.id,
          taskType: "validate",
          status: "pending",
          description: `AI-generated L2 node: "${node.name}" — verify this component classification is accurate`,
        });
        rTasksCreated++;
      }
    }

    if (l2Created > 0 || l3Created > 0) {
      await tx.insert(activityLogTable).values({
        type: "l2_created",
        description: `AI generated ${l2Created} new L2 nodes (${l2Updated} updated), ${l3Created} L3 nodes for "${project.name}"`,
        projectId,
      });
    }

    if (l3Created > 0) {
      const subscribers = await tx
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.publisherProjectId, projectId));
      for (const sub of subscribers) {
        await tx.insert(notificationsTable).values({
          projectId: sub.subscriberProjectId,
          type: "new_l3_node",
          payload: { l3Count: l3Created, projectId },
          read: false,
        });
      }
      void notifyExternalIntegrations(projectId, project.name, "new_l3_node", {
        l3Count: l3Created,
        projectId,
      });
    }

    return { l2Created, l2Updated, l3Created, rTasksCreated, crossLinks };
  }
}
