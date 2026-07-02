import { db } from "@workspace/db";
import {
  l2NodesTable,
  reviewTasksTable,
  nodeLinksTable,
  subscriptionsTable,
  notificationsTable,
  projectsTable,
} from "@workspace/db";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { cosineSimilarity } from "./embedding.js";
import { notifyExternalIntegrations } from "./slack-teams-client.js";
import { logger } from "../utils/logger.js";

export async function detectCrossProjectLinks(
  newNodeId: number,
  newNodeEmbedding: number[],
  projectId: number,
  options?: {
    commitSha?: string;
    diffSummary?: string;
    nodeContext?: {
      hasDocuments?: boolean;
      l1TagIds?: number[];
    };
  }
): Promise<void> {
  if (newNodeEmbedding.length !== 1536) {
    logger.warn(
      { newNodeId, length: newNodeEmbedding.length },
      "Invalid embedding length for cross-project linking. Expected 1536."
    );
    return;
  }

  const SIMILARITY_THRESHOLD = parseFloat(process.env.CROSS_PROJECT_SIMILARITY_THRESHOLD || "0.85");
  const MAX_DISTANCE = 1 - SIMILARITY_THRESHOLD;

  let similarNodes: Array<{ id: number; name: string; projectId: number; sim: number }> = [];

  try {
    // Try pgvector SQL distance first O(log N)
    const results = await db
      .select({
        id: l2NodesTable.id,
        name: l2NodesTable.name,
        projectId: l2NodesTable.projectId,
        distance: sql<number>`(${l2NodesTable.embedding} <=> ${JSON.stringify(newNodeEmbedding)}::vector)`,
      })
      .from(l2NodesTable)
      .where(
        and(
          ne(l2NodesTable.projectId, projectId),
          isNotNull(l2NodesTable.embedding),
          sql`(${l2NodesTable.embedding} <=> ${JSON.stringify(newNodeEmbedding)}::vector) <= ${MAX_DISTANCE}`
        )
      )
      .limit(10);

    similarNodes = results.map((r) => ({
      ...r,
      sim: 1 - r.distance,
    }));
  } catch (err) {
    logger.warn({ err }, "pgvector query failed, falling back to O(N^2) in-memory scanning");
    // Fallback: JS in-memory O(N²) scanning
    const otherNodes = await db
      .select()
      .from(l2NodesTable)
      .where(and(ne(l2NodesTable.projectId, projectId), isNotNull(l2NodesTable.embedding)));

    for (const other of otherNodes) {
      const otherEmb = other.embedding;
      if (!otherEmb) continue;

      const sim = cosineSimilarity(newNodeEmbedding, otherEmb);
      if (sim >= SIMILARITY_THRESHOLD) {
        similarNodes.push({
          id: other.id,
          name: other.name,
          projectId: other.projectId,
          sim,
        });
      }
    }
  }

  for (const other of similarNodes) {
    const sim = other.sim;
    const alreadyExists = await db
      .select({ count: sql<number>`count(*)` })
      .from(reviewTasksTable)
      .where(
        and(
          eq(reviewTasksTable.entityType, "l2_node"),
          eq(reviewTasksTable.entityId, newNodeId),
          eq(reviewTasksTable.taskType, "merge"),
          eq(reviewTasksTable.status, "pending")
        )
      );

    const count = Number(alreadyExists[0]?.count ?? 0);
    if (count === 0) {
      await db.insert(reviewTasksTable).values({
        entityType: "l2_node",
        entityId: newNodeId,
        taskType: "merge",
        status: "pending",
        description: `Cross-project similarity detected (${Math.round(sim * 100)}%): This module resembles "${other.name}" (node #${other.id}) from another project. Consider creating a dependency link.`,
      });

      let linkType = "IMPLEMENTS";
      if (options?.commitSha) {
        linkType = "EVOLVED_INTO";
      } else if (options?.nodeContext?.hasDocuments) {
        linkType = "EXPLAINS";
      }

      // Populate Knowledge Graph Edges (Cross-Project)
      await db.insert(nodeLinksTable).values({
        sourceNodeId: newNodeId,
        targetNodeId: other.id,
        linkType,
        commitSha: options?.commitSha,
        diffSummary: options?.diffSummary,
      });

      const crossLinkPayload = {
        sourceProjectId: projectId,
        targetProjectId: other.projectId,
        similarity: Math.round(sim * 100) / 100,
      };
      const affectedProjectIds = [projectId, other.projectId];
      for (const affectedId of affectedProjectIds) {
        const subscribers = await db
          .select()
          .from(subscriptionsTable)
          .where(eq(subscriptionsTable.publisherProjectId, affectedId));
        for (const sub of subscribers) {
          await db.insert(notificationsTable).values({
            projectId: sub.subscriberProjectId,
            type: "cross_link_detected",
            payload: crossLinkPayload,
            read: false,
          });
        }
      }
      const [projectRow] = await db
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId));
      void notifyExternalIntegrations(
        projectId,
        projectRow?.name ?? `Project #${projectId}`,
        "cross_link_detected",
        crossLinkPayload
      );
    }
  }
}
