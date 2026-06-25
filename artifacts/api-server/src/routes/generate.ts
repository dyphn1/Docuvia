import { Router } from "express";
import { db } from "@workspace/db";
import {
  projectsTable,
  commitsTable,
  l1TagsTable,
  l2NodesTable,
  l2NodeL1TagsTable,
  l3NodesTable,
  reviewTasksTable,
  activityLogTable,
  llmConfigsTable,
  documentsTable,
  promptTemplatesTable,
  correctionExamplesTable,
  subscriptionsTable,
  notificationsTable,
  commitL2LinksTable,
} from "@workspace/db";
import { desc, eq, and, sql, isNull, ne, isNotNull, inArray, or, lt } from "drizzle-orm";
import { generateEmbedding, cosineSimilarity, parseEmbedding } from "../lib/embedding.js";
import { openai } from "@workspace/integrations-openai-ai-server";
import { notifyExternalIntegrations } from "../lib/slack-teams-client.js";
import { LocalGitClient } from "../lib/git-client.js";
import { logger } from "../lib/logger.js";
import { z } from "zod";
import { DEFAULT_PROMPTS } from "./templates.js";

async function getPromptTemplate(projectId: number, templateType: string): Promise<string> {
  const [template] = await db
    .select()
    .from(promptTemplatesTable)
    .where(
      and(
        eq(promptTemplatesTable.projectId, projectId),
        eq(promptTemplatesTable.templateType, templateType as any),
        eq(promptTemplatesTable.isActive, true)
      )
    )
    .orderBy(desc(promptTemplatesTable.createdAt))
    .limit(1);

  if (template) {
    return `${template.systemPrompt}\n\nOUTPUT MUST BE VALID JSON ONLY. NO MARKDOWN WRAPPERS. DO NOT OUTPUT \`\`\`json`;
  }

  // Fallback to global defaults if no project-specific template exists
  const [globalTemplate] = await db
    .select()
    .from(promptTemplatesTable)
    .where(
      and(
        isNull(promptTemplatesTable.projectId),
        eq(promptTemplatesTable.templateType, templateType as any),
        eq(promptTemplatesTable.isActive, true)
      )
    )
    .orderBy(desc(promptTemplatesTable.createdAt))
    .limit(1);

  if (globalTemplate) {
    return `${globalTemplate.systemPrompt}\n\nOUTPUT MUST BE VALID JSON ONLY. NO MARKDOWN WRAPPERS. DO NOT OUTPUT \`\`\`json`;
  }

  // Fallback to hardcoded defaults
  const hardcodedDefault =
    DEFAULT_PROMPTS[templateType as keyof typeof DEFAULT_PROMPTS] || "You are an AI assistant.";
  return `${hardcodedDefault}\n\nOUTPUT MUST BE VALID JSON ONLY. NO MARKDOWN WRAPPERS. DO NOT OUTPUT \`\`\`json`;
}

const router = Router();

import { GenerateKnowledgeBody, ExtractAndSieveBody } from "@workspace/api-zod";

async function getModel(projectId: number, override?: string): Promise<string> {
  if (override) return override;
  const [cfg] = await db
    .select()
    .from(llmConfigsTable)
    .where(eq(llmConfigsTable.projectId, projectId));
  return cfg?.model ?? "gpt-5.2";
}

async function getRecentCorrections(
  projectId: number,
  entityType: "l2_node" | "l3_node"
): Promise<Array<{ original: string; corrected: string }>> {
  const examples = await db
    .select()
    .from(correctionExamplesTable)
    .where(
      and(
        eq(correctionExamplesTable.projectId, projectId),
        eq(correctionExamplesTable.entityType, entityType)
      )
    )
    .orderBy(sql`${correctionExamplesTable.createdAt} desc`)
    .limit(5);
  return examples.map((e) => ({ original: e.originalContent, corrected: e.correctedContent }));
}

function buildFewShotSection(corrections: Array<{ original: string; corrected: string }>): string {
  if (corrections.length === 0) return "";
  const examples = corrections
    .map((c, i) => `Example ${i + 1}:\n  Original: "${c.original}"\n  Corrected: "${c.corrected}"`)
    .join("\n");
  return `\n\nPrevious human corrections (use these as quality guidance):\n${examples}`;
}

/**
 * Re-synthesize L3 node content from its source commits using AI condensation.
 */
async function condenseL3Node(
  node: { id: number; title: string; content: string | null; sourceCommits: unknown },
  model: string
): Promise<string | null> {
  const commits = Array.isArray(node.sourceCommits) ? (node.sourceCommits as string[]) : [];
  if (!commits.length) return null;

  try {
    // Max's Rule: Progressive batch mode to prevent Context Limit OOM and 429 Rate Limits
    const batchSize = 20;
    let synthesizedContent = "";

    for (let i = 0; i < commits.length; i += batchSize) {
      const commitBatchHashes = commits.slice(i, i + batchSize);

      const commitData = await db
        .select({ hash: commitsTable.hash, message: commitsTable.message })
        .from(commitsTable)
        .where(inArray(commitsTable.hash, commitBatchHashes));

      if (!commitData.length) continue;

      const commitSummary = commitData
        .map((c) => `[${c.hash.slice(0, 8)}] ${c.message}`)
        .join("\n");

      try {
        const response = await openai.chat.completions.create({
          model,
          max_completion_tokens: 1024,
          messages: [
            {
              role: "system",
              content:
                "You are a technical writer. Given a knowledge node's title, existing content, and related commits, synthesize an updated comprehensive content string. Return only the new content text.",
            },
            {
              role: "user",
              content: `Node title: "${node.title}"\nExisting content: "${synthesizedContent || node.content || ""}"\nRelated commits:\n${commitSummary}\n\nSynthesize updated content:`,
            },
          ],
        });
        synthesizedContent = response.choices[0]?.message?.content ?? synthesizedContent;
        // Sleep to prevent rate limit
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (e) {
        logger.warn({ err: e }, "Failed to generate chunk");
        throw e;
      }
    }

    return synthesizedContent || null;
  } catch (err) {
    logger.error({ err }, "Failed to condense L3 node");
    return null;
  }
}

async function generateL1Tags(
  commits: Array<{ message: string; hash: string }>,
  existingTags: string[],
  model: string,
  systemPromptOverride: string
): Promise<Array<{ name: string; category: string; description: string }>> {
  const commitList = commits.map((c) => `- ${c.message}`).join("\n");
  const existing = existingTags.length
    ? `\nExisting global tags (reuse if applicable): ${existingTags.join(", ")}`
    : "";

  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: 2048,
    messages: [
      {
        role: "system",
        content: systemPromptOverride,
      },
      {
        role: "user",
        content: `Commits:\n${commitList}${existing}\n\nGenerate L1 tags as JSON array:`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "[]";
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    return [];
  }
}

interface L3NodeAI {
  title: string;
  nodeType: "change" | "rule" | "decision" | "context";
  content: string;
  commitHash: string;
  confidence: number;
}

interface L2NodeAI {
  name: string;
  type: "package" | "module" | "pcd";
  description: string;
  l1TagNames: string[];
  l3Nodes: L3NodeAI[];
}

async function generateL2Nodes(
  commits: Array<{ message: string; hash: string }>,
  l1Tags: Array<{ id: number; name: string }>,
  documentContext: string,
  model: string,
  systemPromptOverride: string,
  corrections: Array<{ original: string; corrected: string }>,
  previousL2Names?: string[]
): Promise<L2NodeAI[]> {
  const commitList = commits.map((c) => `[${c.hash.slice(0, 8)}] ${c.message}`).join("\n");
  const tagNames = l1Tags.map((t) => t.name).join(", ");
  const docSection = documentContext
    ? `\n\nProject documentation context (use this to enrich descriptions and detect architectural decisions):\n${documentContext}`
    : "";
  const fewShotSection = buildFewShotSection(corrections);
  const previousBatchSection =
    previousL2Names && previousL2Names.length > 0
      ? `\n\nL2 modules discovered in previous batches (maintain consistency with these names): ${previousL2Names.join(", ")}`
      : "";

  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: 4096,
    messages: [
      {
        role: "system",
        content: systemPromptOverride,
      },
      {
        role: "user",
        content: `Available L1 tags to map L2 nodes to: ${tagNames}${docSection}${fewShotSection}${previousBatchSection}\n\nCommits to analyze:\n${commitList}\n\nGenerate L2/L3 knowledge nodes as JSON array:`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "[]";
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    return [];
  }
}

async function detectCrossProjectLinks(
  newNodeId: number,
  newNodeEmbedding: number[],
  projectId: number
): Promise<void> {
  const SIMILARITY_THRESHOLD = 0.85;

  const otherNodes = await db
    .select()
    .from(l2NodesTable)
    .where(and(ne(l2NodesTable.projectId, projectId), isNotNull(l2NodesTable.embedding)));

  for (const other of otherNodes) {
    const otherEmb = parseEmbedding(other.embedding);
    if (!otherEmb) continue;

    const sim = cosineSimilarity(newNodeEmbedding, otherEmb);
    if (sim >= SIMILARITY_THRESHOLD) {
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
}

async function runNoiseDetection(projectId: number): Promise<number> {
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

const SieveExtractionInputSchema = z.object({
  sourceText: z.string(),
  sourceFile: z.string().optional(),
  commitHash: z.string().optional(),
});

async function runSieveModel(
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
    decisionEmbedding = await generateEmbedding(textToEmbed);
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
      const nodeEmb = parseEmbedding(node.embedding);
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

router.post("/projects/:id/extract/sieve", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const bodyParsed = SieveExtractionInputSchema.safeParse(req.body ?? {});
  if (!bodyParsed.success) return res.status(400).json({ error: "Invalid input" });

  const { sourceText, sourceFile, commitHash } = bodyParsed.data;

  // Track A (Snippet/Strict) vs Track B (Bulk/Lenient)
  const isTrackA = !!sourceFile && !sourceFile.includes(",");

  const l2Nodes = await db.select().from(l2NodesTable).where(eq(l2NodesTable.projectId, projectId));
  const sysUncatNode = l2Nodes.find((n) => n.type === "sys-uncategorized");
  const sysUncategorizedId = sysUncatNode?.id ?? 0;

  const model = await getModel(projectId);
  const systemPrompt = await getPromptTemplate(projectId, "l3_generator");

  let extracted: any[] = [];
  try {
    const response = await openai.chat.completions.create({
      model,
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Extract architecture decisions from this text as a JSON array of objects with 'title' and 'nodeType' (change|rule|decision|context):\n\n${sourceText}`,
        },
      ],
    });
    const content = response.choices[0]?.message?.content ?? "[]";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.error({ err }, "Extraction failed");
    return res.status(500).json({ error: "Failed to extract decisions" });
  }

  const decisions = await Promise.all(
    extracted.map(async (dec) => {
      const textToEmbed = `${dec.title}\n${dec.nodeType}`;
      let l2NodeId = sysUncategorizedId;
      let confidence = 0.1;

      if (isTrackA) {
        const { bestNodeId, confidence: conf } = await runSieveModel(
          sourceFile,
          commitHash,
          textToEmbed,
          l2Nodes,
          sysUncategorizedId
        );
        l2NodeId = bestNodeId;
        confidence = conf;
      } else {
        // Track B: fallback to sys-uncategorized initially, then use Sieve to suggest
        const { bestNodeId, confidence: conf } = await runSieveModel(
          undefined,
          commitHash,
          textToEmbed,
          l2Nodes,
          sysUncategorizedId
        );
        l2NodeId = bestNodeId; // Return suggestion
        confidence = conf * 0.8; // Lower confidence for bulk
      }

      return {
        l2NodeId,
        title: dec.title || "Unknown Decision",
        nodeType: dec.nodeType || "context",
        confidence,
        noiseScore: 0.1,
      };
    })
  );

  return res.json({ decisions });
});
router.post("/projects/:id/generate", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const body = GenerateKnowledgeBody.parse(req.body ?? {});
  const model = await getModel(projectId, body.model);
  const maxCommits = body.maxCommits ?? 50;
  const mode = body.mode ?? "full";

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
    return res.status(409).json({ error: "Project is already indexing or not in active state." });
  }

  // TODO: [CRITICAL BUG FIX] - Missing transaction wrapper. The entire generation pipeline executing discrete `db.insert()` and `db.update()` statements MUST be wrapped in a `db.transaction()` block to prevent DB corruption if an LLM call fails.
  try {
    // Step 1: Fetch valid (signal-scored) commits
    const validCommits = await db
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
      await db
        .update(projectsTable)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(projectsTable.id, projectId));
      return res.json({
        l1TagsCreated: 0,
        l2NodesCreated: 0,
        l3NodesCreated: 0,
        reviewTasksCreated: 0,
        commitsProcessed: 0,
        crossProjectLinksDetected: 0,
        noiseTasksCreated: 0,
      });
    }

    const commitData = validCommits.map((c) => ({ message: c.message, hash: c.hash }));

    // Step 2: Fetch project documents for context enrichment
    const documents = await db
      .select({
        filename: documentsTable.filename,
        content: documentsTable.content,
        docType: documentsTable.docType,
      })
      .from(documentsTable)
      .where(eq(documentsTable.projectId, projectId));

    const documentContext = documents.length
      ? documents
          .map((d) => `[${d.docType.toUpperCase()}] ${d.filename}:\n${d.content.slice(0, 800)}`)
          .join("\n\n---\n\n")
      : "";

    // Step 3: L1 Tagger — using project template if available
    const l1SystemPrompt = await getPromptTemplate(projectId, "l1_tagger");
    const existingL1 = await db.select().from(l1TagsTable);
    const existingTagNames = existingL1.map((t) => t.name);
    const aiL1Tags = await generateL1Tags(commitData, existingTagNames, model, l1SystemPrompt);

    let l1TagsCreated = 0;
    let reviewTasksCreated = 0;
    const tagMap = new Map<string, number>();

    for (const existing of existingL1) {
      tagMap.set(existing.name.toLowerCase(), existing.id);
    }

    // Pre-generate embeddings for existing L1 tags to enable semantic dedup
    const existingL1Embeddings: Array<{ id: number; embedding: number[] | null }> =
      await Promise.all(
        existingL1.map(async (tag) => ({
          id: tag.id,
          embedding: await generateEmbedding(`${tag.name} ${tag.description ?? ""}`.trim()),
        }))
      );

    for (const tag of aiL1Tags) {
      const key = tag.name.toLowerCase();
      if (tagMap.has(key)) continue;

      // Semantic dedup: check if candidate is similar to an existing tag
      const candidateEmb = await generateEmbedding(`${tag.name} ${tag.description ?? ""}`.trim());
      if (candidateEmb) {
        let maxSim = 0;
        let bestMatchId: number | undefined;
        for (const existEmb of existingL1Embeddings) {
          if (!existEmb.embedding) continue;
          const sim = cosineSimilarity(candidateEmb, existEmb.embedding);
          if (sim > maxSim) {
            maxSim = sim;
            bestMatchId = existEmb.id;
          }
        }
        if (maxSim >= similarityThreshold && bestMatchId !== undefined) {
          tagMap.set(key, bestMatchId);
          continue;
        }
      }

      try {
        const [created] = await db
          .insert(l1TagsTable)
          .values({
            name: tag.name,
            category: tag.category ?? "Feature",
            description: tag.description,
            isAnchored: false,
          })
          .returning();
        tagMap.set(key, created.id);
        l1TagsCreated++;
        // Create anchor review task for each new AI-generated L1 tag
        await db.insert(reviewTasksTable).values({
          entityType: "l1_tag",
          entityId: created.id,
          taskType: "anchor",
          status: "pending",
          description: `New L1 tag "${tag.name}" generated by AI — review and anchor if accurate`,
        });
        reviewTasksCreated++;
      } catch {
        const [existing] = await db
          .select()
          .from(l1TagsTable)
          .where(eq(l1TagsTable.name, tag.name));
        if (existing) tagMap.set(key, existing.id);
      }
    }

    if (l1TagsCreated > 0) {
      await db.insert(activityLogTable).values({
        type: "tag_added",
        description: `AI generated ${l1TagsCreated} L1 tags for "${project.name}"`,
        projectId,
      });
    }

    // Step 4: L2 Extractor + L3 Generator — using templates + feedback loop corrections
    const l2SystemPrompt = await getPromptTemplate(projectId, "l2_extractor");
    const corrections = await getRecentCorrections(projectId, "l2_node");
    const allL1Tags = await db.select().from(l1TagsTable);

    let l2NodesCreated = 0;
    let l2NodesUpdated = 0;
    let l3NodesCreated = 0;
    let crossProjectLinksDetected = 0;

    // Build a hash → commit id map for commit→L2 backfill
    const commitHashMap = new Map<string, number>();
    for (const c of validCommits) {
      commitHashMap.set(c.hash.slice(0, 8), c.id);
      commitHashMap.set(c.hash, c.id);
    }

    // Fetch existing L2 nodes for bootstrap check and deduplication
    const existingL2 = await db
      .select()
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId));
    const existingL2Map = new Map<string, (typeof existingL2)[0]>();
    for (const node of existingL2) {
      existingL2Map.set(node.name.toLowerCase(), node);
    }

    // Check if all L2 nodes are bootstrap-confirmed (path-rule mode)
    const allBootstrapConfirmed =
      existingL2.length > 0 && existingL2.every((n) => n.isBootstrapConfirmed);

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
          [sysNode] = await db
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

          await db
            .update(commitsTable)
            .set({ l2NodeId: targetNodeId })
            .where(eq(commitsTable.id, commit.id))
            .catch(() => {});

          await db
            .insert(commitL2LinksTable)
            .values({
              commitId: commit.id,
              l2NodeId: targetNodeId,
            })
            .onConflictDoNothing()
            .catch(() => {});
        }
      } finally {
        await gitClient.cleanup();
      }
    } else {
      // Bootstrap mode: batch 20 commits per LLM call, pass previous L2 list for self-correction
      const BATCH_SIZE = 20;
      const previousL2Names: string[] = [];

      for (let batchStart = 0; batchStart < commitData.length; batchStart += BATCH_SIZE) {
        const batchCommits = commitData.slice(batchStart, batchStart + BATCH_SIZE);
        const batchResult = await generateL2Nodes(
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

      // Deduplication: update if already exists, insert if new
      if (existingL2Map.has(nameKey)) {
        const existing = existingL2Map.get(nameKey)!;
        const [updated] = await db
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
        l2NodesUpdated++;
      } else {
        const [created] = await db
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
        l2NodesCreated++;
      }

      // Generate and store embedding for the L2 node
      const l2EmbText = `${l2data.name} ${l2data.description ?? ""}`.trim();
      const l2Embedding = await generateEmbedding(l2EmbText);
      if (l2Embedding) {
        await db
          .update(l2NodesTable)
          .set({ embedding: JSON.stringify(l2Embedding) })
          .where(eq(l2NodesTable.id, l2node.id));

        // Cross-project AI detection: run for all processed L2 nodes
        await detectCrossProjectLinks(l2node.id, l2Embedding, projectId);
        crossProjectLinksDetected++;
      }

      // Wire L1 tags
      for (const tagName of l2data.l1TagNames ?? []) {
        const tagId =
          tagMap.get(tagName.toLowerCase()) ??
          allL1Tags.find((t) => t.name.toLowerCase() === tagName.toLowerCase())?.id;
        if (tagId) {
          await db
            .insert(l2NodeL1TagsTable)
            .values({ l2NodeId: l2node.id, l1TagId: tagId })
            .catch(() => {});
          await db
            .update(l1TagsTable)
            .set({ usageCount: sql`${l1TagsTable.usageCount} + 1` })
            .where(eq(l1TagsTable.id, tagId));
        }
      }

      // Load existing L3 nodes for this L2 node (for semantic dedup)
      const existingL3ForNode = await db
        .select()
        .from(l3NodesTable)
        .where(and(eq(l3NodesTable.l2NodeId, l2node.id), isNotNull(l3NodesTable.embedding)));

      // Step 5: L3 nodes — semantic dedup before insert
      for (const l3data of l2data.l3Nodes ?? []) {
        const confidence =
          typeof l3data.confidence === "number"
            ? Math.max(0, Math.min(1, l3data.confidence))
            : 0.75;

        // Generate embedding for candidate L3 node
        const l3EmbText = `${l3data.title} ${l3data.content ?? ""}`.trim();
        const l3Embedding = await generateEmbedding(l3EmbText);

        // Find most similar existing L3 node for this L2
        let maxL3Sim = 0;
        let bestL3Match: (typeof existingL3ForNode)[0] | undefined;
        if (l3Embedding) {
          for (const existNode of existingL3ForNode) {
            const existEmb = parseEmbedding(existNode.embedding);
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

          await db
            .update(l3NodesTable)
            .set({ occurrenceCount: newOccurrenceCount })
            .where(eq(l3NodesTable.id, bestL3Match.id));

          // Condensation check
          if (newOccurrenceCount >= condensationThreshold) {
            const condensed = await condenseL3Node(bestL3Match as any, model);
            if (condensed) {
              await db
                .update(l3NodesTable)
                .set({ content: condensed })
                .where(eq(l3NodesTable.id, bestL3Match.id));
            }
            if (condensationReviewRequired) {
              await db.insert(reviewTasksTable).values({
                entityType: "l3_node",
                entityId: bestL3Match.id,
                taskType: "validate",
                status: "pending",
                description: `L3 node "${bestL3Match.title}" condensed (${newOccurrenceCount} occurrences) — review AI-synthesized content`,
              });
              reviewTasksCreated++;
            }
          }
        } else {
          // Insert new L3 node with validity pending (section 2.4)
          const [l3node] = await db
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
          l3NodesCreated++;

          // Store embedding and add to cache for subsequent dedup in this batch
          if (l3Embedding) {
            await db
              .update(l3NodesTable)
              .set({ embedding: JSON.stringify(l3Embedding) })
              .where(eq(l3NodesTable.id, l3node.id));
            existingL3ForNode.push({ ...l3node, embedding: JSON.stringify(l3Embedding) });
          }

          // Queue review task for low-confidence nodes
          if (confidence < 0.8) {
            await db.insert(reviewTasksTable).values({
              entityType: "l3_node",
              entityId: l3node.id,
              taskType: "validate",
              status: "pending",
              description: `AI-generated L3 node (confidence ${Math.round(confidence * 100)}%): "${l3data.title}" — verify content accuracy`,
            });
            reviewTasksCreated++;
          }
        }

        // Step 6: Backfill commit → L2 link via commit hash (always, regardless of dedup)
        if (l3data.commitHash) {
          const commitId =
            commitHashMap.get(l3data.commitHash) ??
            commitHashMap.get(l3data.commitHash.slice(0, 8));
          if (commitId) {
            await db
              .update(commitsTable)
              .set({ l2NodeId: l2node.id })
              .where(eq(commitsTable.id, commitId))
              .catch(() => {});
            // Also insert into commit_l2_links junction table (v2)
            await db
              .insert(commitL2LinksTable)
              .values({ commitId: commitId, l2NodeId: l2node.id })
              .catch(() => {});
          }
        }
      }
    }

    // Create single L2 review tasks for newly created nodes
    const postL2 = await db
      .select()
      .from(l2NodesTable)
      .where(and(eq(l2NodesTable.projectId, projectId), eq(l2NodesTable.needsReview, true)));
    const pendingL2Reviews = await db
      .select()
      .from(reviewTasksTable)
      .where(
        and(eq(reviewTasksTable.entityType, "l2_node"), eq(reviewTasksTable.status, "pending"))
      );
    const coveredL2Ids = new Set(pendingL2Reviews.map((t) => t.entityId));

    for (const node of postL2) {
      if (!coveredL2Ids.has(node.id)) {
        await db.insert(reviewTasksTable).values({
          entityType: "l2_node",
          entityId: node.id,
          taskType: "validate",
          status: "pending",
          description: `AI-generated L2 node: "${node.name}" — verify this component classification is accurate`,
        });
        reviewTasksCreated++;
      }
    }

    if (l2NodesCreated > 0 || l3NodesCreated > 0) {
      await db.insert(activityLogTable).values({
        type: "l2_created",
        description: `AI generated ${l2NodesCreated} new L2 nodes (${l2NodesUpdated} updated), ${l3NodesCreated} L3 nodes for "${project.name}"`,
        projectId,
      });
    }

    if (l3NodesCreated > 0) {
      const subscribers = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.publisherProjectId, projectId));
      for (const sub of subscribers) {
        await db.insert(notificationsTable).values({
          projectId: sub.subscriberProjectId,
          type: "new_l3_node",
          payload: { l3Count: l3NodesCreated, projectId },
          read: false,
        });
      }
      void notifyExternalIntegrations(projectId, project.name, "new_l3_node", {
        l3Count: l3NodesCreated,
        projectId,
      });
    }

    // Step 7: Noise detection — run after all nodes are created
    const noiseTasksCreated = await runNoiseDetection(projectId);
    if (noiseTasksCreated > 0) {
      reviewTasksCreated += noiseTasksCreated;
      await db.insert(activityLogTable).values({
        type: "review_resolved",
        description: `Noise detection flagged ${noiseTasksCreated} L1 tag issue(s) for review`,
        projectId,
      });
    }

    // Mark commits as processed in incremental mode
    if (mode === "incremental" && validCommits.length > 0) {
      const commitIds = validCommits.map((c) => c.id);
      await db
        .update(commitsTable)
        .set({ processedAt: new Date() })
        .where(inArray(commitsTable.id, commitIds));
    }

    await db
      .update(projectsTable)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));

    return res.json({
      l1TagsCreated,
      l2NodesCreated,
      l2NodesUpdated,
      l3NodesCreated,
      reviewTasksCreated,
      commitsProcessed: validCommits.length,
      documentsUsed: documents.length,
      crossProjectLinksDetected,
      noiseTasksCreated,
    });
  } catch (err) {
    await db
      .update(projectsTable)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));
    throw err;
  }
});

router.post("/admin/reindex-embeddings", async (req, res) => {
  const l2Nodes = await db.select().from(l2NodesTable).where(isNull(l2NodesTable.embedding));
  let l2Done = 0;
  for (const node of l2Nodes) {
    const text = `${node.name} ${node.description ?? ""}`.trim();
    const emb = await generateEmbedding(text);
    if (emb) {
      await db
        .update(l2NodesTable)
        .set({ embedding: JSON.stringify(emb) })
        .where(eq(l2NodesTable.id, node.id));
      l2Done++;
    }
  }

  const l3Nodes = await db.select().from(l3NodesTable).where(isNull(l3NodesTable.embedding));
  let l3Done = 0;
  for (const node of l3Nodes) {
    const text = `${node.title} ${node.content ?? ""}`.trim();
    const emb = await generateEmbedding(text);
    if (emb) {
      await db
        .update(l3NodesTable)
        .set({ embedding: JSON.stringify(emb) })
        .where(eq(l3NodesTable.id, node.id));
      l3Done++;
    }
  }

  res.json({ l2Reindexed: l2Done, l3Reindexed: l3Done });
});

export default router;
