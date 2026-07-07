import { db } from "@workspace/db";
import {
  l1TagsTable,
  reviewTasksTable,
  commitsTable,
  commitL2LinksTable,
  l2NodesTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { generateEmbedding, cosineSimilarity } from "./embedding.js";
import { logger } from "../utils/logger.js";

export async function runNoiseDetection(db: any, projectId: number): Promise<number> {
  let noiseTasksCreated = 0;

  const allTags = await db.select().from(l1TagsTable);

  for (const tag of allTags) {
    if (tag.isAnchored) continue;

    if (tag.usageCount <= 1) {
      const alreadyFlagged = await db
        .select({ count: sql<number>`count(*)` })
        .from(reviewTasksTable)
        .where(
          and(
            eq(reviewTasksTable.entityType, "l1_tag"),
            eq(reviewTasksTable.entityId, tag.id),
            eq(reviewTasksTable.taskType, "anchor"),
            eq(reviewTasksTable.status, "pending")
          )
        );
      if (Number(alreadyFlagged[0]?.count ?? 0) === 0) {
        await db.insert(reviewTasksTable).values({
          entityType: "l1_tag",
          entityId: tag.id,
          taskType: "anchor",
          status: "pending",
          description: `Noise detection: Tag "${tag.name}" has very low usage (${tag.usageCount} times). Consider merging with an existing tag or removing it.`,
        });
        noiseTasksCreated++;
      }
    }
  }

  for (let i = 0; i < allTags.length; i++) {
    for (let j = i + 1; j < allTags.length; j++) {
      const a = allTags[i];
      const b = allTags[j];
      if (!a || !b) continue;
      const aName = a.name.toLowerCase().replace(/[-_\s]/g, "");
      const bName = b.name.toLowerCase().replace(/[-_\s]/g, "");
      if (aName === bName || aName.startsWith(bName) || bName.startsWith(aName)) {
        const aId = Math.min(a.id, b.id);
        const bId = Math.max(a.id, b.id);
        const alreadyFlagged = await db
          .select({ count: sql<number>`count(*)` })
          .from(reviewTasksTable)
          .where(
            and(
              eq(reviewTasksTable.entityType, "l1_tag"),
              eq(reviewTasksTable.entityId, aId),
              eq(reviewTasksTable.taskType, "merge"),
              eq(reviewTasksTable.status, "pending")
            )
          );
        if (Number(alreadyFlagged[0]?.count ?? 0) === 0) {
          await db.insert(reviewTasksTable).values({
            entityType: "l1_tag",
            entityId: aId,
            taskType: "merge",
            status: "pending",
            description: `Noise detection: Tag "${a.name}" appears to be a near-duplicate of "${b.name}". Consider merging these tags.`,
          });
          noiseTasksCreated++;
        }
      }
    }
  }

  return noiseTasksCreated;
}

export async function runSieveModel(
  projectId: number,
  sourceFile: string | undefined,
  commitHash: string | undefined,
  textToEmbed: string,
  l2Nodes: (typeof l2NodesTable.$inferSelect)[],
  sysUncategorizedId: number
): Promise<{ bestNodeId: number; confidence: number }> {
  const W1 = 0.3; // GitHistory
  const W2 = 0.2; // AST_Dep
  const W3 = 0.3; // DirStructure
  const W4 = 0.2; // SemanticVector

  let decisionEmbedding: number[] | null = null;
  try {
    decisionEmbedding = await generateEmbedding(projectId, textToEmbed);
  } catch (err) {
    logger.warn({ err }, "Failed to generate embedding for Sieve Model");
  }

  let bestScore = -1;
  let bestNodeId = sysUncategorizedId;

  let commitLinkedNodeIds: number[] = [];
  if (commitHash) {
    const [commitRecord] = await db
      .select({ id: commitsTable.id })
      .from(commitsTable)
      .where(eq(commitsTable.hash, commitHash));
    if (commitRecord) {
      const links = await db
        .select()
        .from(commitL2LinksTable)
        .where(eq(commitL2LinksTable.commitId, commitRecord.id));
      commitLinkedNodeIds = links.map((l: any) => l.l2NodeId);
    }
  }

  for (const node of l2Nodes) {
    if (node.type === "sys-uncategorized") continue;

    let scoreW1 = 0;
    let scoreW2 = 0;
    let scoreW3 = 0;
    let scoreW4 = 0;

    if (commitLinkedNodeIds.includes(node.id)) {
      scoreW1 = 1;
    }

    if (sourceFile && node.pathPatterns) {
      const patterns = node.pathPatterns as string[];
      if (patterns.some((p: string) => sourceFile.startsWith(p) || sourceFile === p)) {
        scoreW3 = 1;
      }
    }

    if (decisionEmbedding && node.embedding) {
      const nodeEmb = node.embedding;
      if (nodeEmb) {
        scoreW4 = cosineSimilarity(decisionEmbedding, nodeEmb);
      }
    }

    const totalScore = scoreW1 * W1 + scoreW2 * W2 + scoreW3 * W3 + scoreW4 * W4;
    if (totalScore > bestScore && totalScore > 0.4) {
      bestScore = totalScore;
      bestNodeId = node.id;
    }
  }

  return {
    bestNodeId,
    confidence: bestScore > 0 ? bestScore : 0.1,
  };
}
