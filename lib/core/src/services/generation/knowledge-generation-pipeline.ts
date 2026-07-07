import { db } from "@workspace/db";
import {
  commitsTable,
  projectsTable,
  documentsTable,
  llmConfigsTable,
  activityLogTable,
} from "@workspace/db";
import { and, eq, isNull, sql, inArray, or, lt } from "drizzle-orm";
import { logger } from "../../utils/logger.js";
import { compressAstContext, CompressibleNode } from "@workspace/ast-core";
import { getModel } from "../prompt-service.js";
import { runNoiseDetection } from "../noise-detection-service.js";
import {
  IKnowledgeGenerationPipeline,
  IL1ProcessingService,
  IL2ProcessingService,
} from "../../interfaces/knowledge-generation.interfaces.js";

export class KnowledgeGenerationPipeline implements IKnowledgeGenerationPipeline {
  constructor(
    private readonly l1ProcessingService: IL1ProcessingService,
    private readonly l2ProcessingService: IL2ProcessingService
  ) {}

  async execute(projectId: number, userId: number | undefined, bodyOptions: any): Promise<any> {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) throw new Error("Project not found");
    if (project.ownerId !== userId) {
      throw new Error("Forbidden: Not project owner");
    }

    const model = await getModel(projectId, bodyOptions.model);
    const maxCommits = bodyOptions.maxCommits ?? 50;
    const mode = bodyOptions.mode ?? "full";

    const [llmCfg] = await db
      .select()
      .from(llmConfigsTable)
      .where(eq(llmConfigsTable.projectId, projectId));
    const similarityThreshold = llmCfg?.similarityThreshold ?? 0.85;
    const condensationThreshold = llmCfg?.condensationThreshold ?? 30;
    const condensationReviewRequired = llmCfg?.condensationReviewRequired ?? false;

    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

    const updatedProjects = await db
      .update(projectsTable)
      .set({ status: "indexing", updatedAt: new Date() })
      .where(
        and(
          eq(projectsTable.id, projectId),
          or(
            inArray(projectsTable.status, ["active", "error"]),
            and(eq(projectsTable.status, "indexing"), lt(projectsTable.updatedAt, thirtyMinsAgo))
          )
        )
      )
      .returning();

    if (updatedProjects.length === 0) {
      throw new Error("Project is already indexing or not in active state.");
    }

    try {
      const result = await db.transaction(async (tx) => {
        // Step 1: Fetch valid (signal-scored) commits
        const validCommits = await tx
          .select()
          .from(commitsTable)
          .where(
            mode === "incremental"
              ? and(
                  eq(commitsTable.projectId, projectId),
                  eq(commitsTable.valid, true),
                  isNull(commitsTable.processedAt)
                )
              : and(eq(commitsTable.projectId, projectId), eq(commitsTable.valid, true))
          )
          .orderBy(sql`${commitsTable.createdAt} desc`)
          .limit(maxCommits);

        if (!validCommits.length) {
          await tx
            .update(projectsTable)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(projectsTable.id, projectId));
          return {
            l1TagsCreated: 0,
            l2NodesCreated: 0,
            l3NodesCreated: 0,
            reviewTasksCreated: 0,
            commitsProcessed: 0,
            crossProjectLinksDetected: 0,
            noiseTasksCreated: 0,
          };
        }

        const commitData = validCommits.map((c) => ({ message: c.message, hash: c.hash }));

        // Step 2: Fetch project documents for context enrichment
        const documents = await tx
          .select({
            filename: documentsTable.filename,
            content: documentsTable.content,
            docType: documentsTable.docType,
          })
          .from(documentsTable)
          .where(eq(documentsTable.projectId, projectId));

        // Compress document context to reduce token volume sent to LLM
        const documentContext = documents.length
          ? (() => {
              const nodes: CompressibleNode[] = documents.map((d) => ({
                title: d.filename,
                content: d.content,
                nodeType: d.docType,
                confidence: 1.0,
              }));
              const compressed = compressAstContext(nodes, {
                maxTotalChars: 6000,
                maxPerNodeChars: 600,
              });
              logger.info(
                {
                  projectId,
                  nodesTotal: compressed.nodesTotal,
                  nodesIncluded: compressed.nodesIncluded,
                  charsSaved: compressed.charsSaved,
                },
                "[generate] Document context compressed"
              );
              return compressed.context;
            })()
          : "";

        // Declarations
        let l1TagsCreated = 0;
        let reviewTasksCreated = 0;
        let l2NodesCreated = 0;
        let l2NodesUpdated = 0;
        let l3NodesCreated = 0;
        let crossProjectLinksDetected = 0;

        // Step 3: L1 Tagger
        const {
          l1TagsCreated: l1c,
          reviewTasksCreated: rtc,
          tagMap,
        } = await this.l1ProcessingService.processL1Tagger(
          tx,
          projectId,
          project.name,
          commitData,
          model,
          similarityThreshold
        );
        l1TagsCreated = l1c;
        reviewTasksCreated = rtc;

        // Steps 4-6: Generate L2/L3 Nodes and process Links
        const { l2Created, l2Updated, l3Created, rTasksCreated, crossLinks } =
          await this.l2ProcessingService.processL2Nodes(
            tx,
            projectId,
            project,
            validCommits,
            commitData,
            documents,
            documentContext,
            tagMap,
            model,
            similarityThreshold,
            condensationThreshold,
            condensationReviewRequired
          );
        l2NodesCreated = l2Created;
        l2NodesUpdated = l2Updated;
        l3NodesCreated = l3Created;
        reviewTasksCreated += rTasksCreated;
        crossProjectLinksDetected = crossLinks;

        // Step 7: Noise detection — run after all nodes are created
        const noiseTasksCreated = await runNoiseDetection(tx, projectId);
        if (noiseTasksCreated > 0) {
          reviewTasksCreated += noiseTasksCreated;
          await tx.insert(activityLogTable).values({
            type: "review_resolved",
            description: `Noise detection flagged ${noiseTasksCreated} L1 tag issue(s) for review`,
            projectId,
          });
        }

        // Mark commits as processed in incremental mode
        if (mode === "incremental" && validCommits.length > 0) {
          const commitIds = validCommits.map((c) => c.id);
          await tx
            .update(commitsTable)
            .set({ processedAt: new Date() })
            .where(inArray(commitsTable.id, commitIds));
        }

        await tx
          .update(projectsTable)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(projectsTable.id, projectId));

        return {
          l1TagsCreated,
          l2NodesCreated,
          l2NodesUpdated,
          l3NodesCreated,
          reviewTasksCreated,
          commitsProcessed: validCommits.length,
          documentsUsed: documents.length,
          crossProjectLinksDetected,
          noiseTasksCreated,
        };
      });

      return result;
    } catch (err) {
      await db
        .update(projectsTable)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(projectsTable.id, projectId));
      throw err;
    }
  }
}
