import { eq, and, isNotNull } from "drizzle-orm";
import { l3NodesTable, reviewTasksTable, commitsTable, commitL2LinksTable } from "@workspace/db";
import {
  IL3ProcessingService,
  ILlmGenerationService,
  L2NodeAI,
} from "../../interfaces/knowledge-generation.interfaces.js";
import { generateEmbedding, cosineSimilarity } from "../embedding.js";
import { logger } from "../../utils/logger.js";

export class L3ProcessingService implements IL3ProcessingService {
  constructor(private readonly llmGenerationService: ILlmGenerationService) {}

  async processL3Nodes(
    tx: any,
    projectId: number,
    l2node: any,
    l2data: L2NodeAI,
    similarityThreshold: number,
    condensationThreshold: number,
    condensationReviewRequired: boolean,
    model: string,
    commitHashMap: Map<string, number>
  ): Promise<{ l3Created: number; rTasksCreated: number }> {
    let l3Created = 0;
    let rTasksCreated = 0;

    // Load existing L3 nodes for this L2 node (for semantic dedup)
    const existingL3ForNode = await tx
      .select()
      .from(l3NodesTable)
      .where(and(eq(l3NodesTable.l2NodeId, l2node.id), isNotNull(l3NodesTable.embedding)));

    for (const l3data of l2data.l3Nodes ?? []) {
      const confidence =
        typeof l3data.confidence === "number" ? Math.max(0, Math.min(1, l3data.confidence)) : 0.75;

      // Generate embedding for candidate L3 node
      const l3EmbText = `${l3data.title} ${l3data.content ?? ""}`.trim();
      const l3Embedding = await generateEmbedding(projectId, l3EmbText);

      // Find most similar existing L3 node for this L2
      let maxL3Sim = 0;
      let bestL3Match: (typeof existingL3ForNode)[0] | undefined;
      if (l3Embedding) {
        for (const existNode of existingL3ForNode) {
          const existEmb = existNode.embedding;
          if (!existEmb) continue;
          const sim = cosineSimilarity(l3Embedding, existEmb);
          if (sim > maxL3Sim) {
            maxL3Sim = sim;
            bestL3Match = existNode;
          }
        }
      }

      if (maxL3Sim >= similarityThreshold && bestL3Match) {
        // Dedup: increment occurrence count
        const newOccurrenceCount = bestL3Match.occurrenceCount + 1;

        await tx
          .update(l3NodesTable)
          .set({ occurrenceCount: newOccurrenceCount })
          .where(eq(l3NodesTable.id, bestL3Match.id));

        // Condensation check
        if (newOccurrenceCount >= condensationThreshold) {
          const condensed = await this.llmGenerationService.condenseL3Node(
            projectId,
            bestL3Match,
            model
          );
          if (condensed) {
            await tx
              .update(l3NodesTable)
              .set({ content: condensed })
              .where(eq(l3NodesTable.id, bestL3Match.id));
          }
          if (condensationReviewRequired) {
            await tx.insert(reviewTasksTable).values({
              entityType: "l3_node",
              entityId: bestL3Match.id,
              taskType: "validate",
              status: "pending",
              description: `L3 node "${bestL3Match.title}" condensed (${newOccurrenceCount} occurrences) — review AI-synthesized content`,
            });
            rTasksCreated++;
          }
        }
      } else {
        // Insert new L3 node with validity pending
        const [l3node] = await tx
          .insert(l3NodesTable)
          .values({
            l2NodeId: l2node.id,
            title: l3data.title,
            content: l3data.content,
            nodeType: l3data.nodeType ?? "change",
            commitHash: l3data.commitHash || null,
            aiGenerated: true,
            confidence,
            occurrenceCount: 1,
            validityStatus: "pending",
          })
          .returning();
        l3Created++;

        // Store embedding and add to cache for subsequent dedup in this batch
        if (l3Embedding) {
          await tx
            .update(l3NodesTable)
            .set({ embedding: l3Embedding })
            .where(eq(l3NodesTable.id, l3node.id));
          existingL3ForNode.push({ ...l3node, embedding: l3Embedding });
        }

        // Queue review task for low-confidence nodes
        if (confidence < 0.8) {
          await tx.insert(reviewTasksTable).values({
            entityType: "l3_node",
            entityId: l3node.id,
            taskType: "validate",
            status: "pending",
            description: `AI-generated L3 node (confidence ${Math.round(confidence * 100)}%): "${l3data.title}" — verify content accuracy`,
          });
          rTasksCreated++;
        }
      }

      // Backfill commit → L2 link via commit hash
      if (l3data.commitHash) {
        const commitId =
          commitHashMap.get(l3data.commitHash) ?? commitHashMap.get(l3data.commitHash.slice(0, 8));
        if (commitId) {
          await tx
            .update(commitsTable)
            .set({ l2NodeId: l2node.id })
            .where(eq(commitsTable.id, commitId))
            .catch((err: unknown) => logger.warn({ err }, "Ignored error"));

          await tx
            .insert(commitL2LinksTable)
            .values({ commitId: commitId, l2NodeId: l2node.id })
            .catch((err: unknown) => logger.warn({ err }, "Ignored error"));
        }
      }
    }

    return { l3Created, rTasksCreated };
  }
}
