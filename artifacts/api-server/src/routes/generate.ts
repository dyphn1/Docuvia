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
} from "@workspace/db";
import { eq, and, sql, isNull } from "drizzle-orm";
import { generateEmbedding } from "../lib/embedding.js";
import { openai } from "@workspace/integrations-openai-ai-server";
import { z } from "zod";

const router = Router();

const GenerateInputSchema = z.object({
  model: z.string().optional(),
  maxCommits: z.number().optional().default(50),
});

async function getModel(projectId: number, override?: string): Promise<string> {
  if (override) return override;
  const [cfg] = await db
    .select()
    .from(llmConfigsTable)
    .where(eq(llmConfigsTable.projectId, projectId));
  return cfg?.model ?? "gpt-5.2";
}

async function generateL1Tags(
  commits: Array<{ message: string; hash: string }>,
  existingTags: string[],
  model: string
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
        content: `You are an expert software architect. Analyze VCS commit messages and extract L1 classification tags.
L1 tags are high-level domain classifications (e.g., "Authentication", "Database", "Networking", "Build System", "Security", "Performance", "UI", "API", "Testing", "Documentation").
Return ONLY a JSON array of tag objects. Each object must have: name (string), category (string), description (string).
Categories: Core, Infrastructure, Quality, Feature, Security, Performance.
Generate 3-8 tags that best represent the commit themes. Prefer reusing existing tags when they match.${existing}`,
      },
      {
        role: "user",
        content: `Commits:\n${commitList}\n\nGenerate L1 tags as JSON array:`,
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
  model: string
): Promise<L2NodeAI[]> {
  const commitList = commits.map((c) => `[${c.hash.slice(0, 8)}] ${c.message}`).join("\n");
  const tagNames = l1Tags.map((t) => t.name).join(", ");
  const docSection = documentContext
    ? `\n\nProject documentation context (use this to enrich descriptions and detect architectural decisions):\n${documentContext}`
    : "";

  const response = await openai.chat.completions.create({
    model,
    max_completion_tokens: 4096,
    messages: [
      {
        role: "system",
        content: `You are an expert software architect analyzing VCS commit history.
Extract L2 nodes (packages/modules/components) and their associated L3 knowledge nodes.

L2 nodes = software components, modules, packages, or PCDs (Platform Configuration Databases for UEFI/firmware).
L3 nodes = implementation rules, technical decisions, change rationale, context.

Available L1 tags to map L2 nodes to: ${tagNames}${docSection}

Return ONLY a valid JSON array. Each L2 node:
{
  "name": "component-name",
  "type": "module" | "package" | "pcd",
  "description": "what this component does",
  "l1TagNames": ["matching tag names from the available list"],
  "l3Nodes": [
    {
      "title": "concise title",
      "nodeType": "change" | "rule" | "decision" | "context",
      "content": "detailed explanation",
      "commitHash": "8-char hash from [xxxxxxxx] prefix or empty string",
      "confidence": 0.0 to 1.0
    }
  ]
}

confidence: 1.0 = certain/explicit in commits, 0.7 = inferred with high confidence, 0.4 = speculative.
Generate 2-6 L2 nodes with 1-3 L3 nodes each.`,
      },
      {
        role: "user",
        content: `Commits to analyze:\n${commitList}\n\nGenerate L2/L3 knowledge nodes as JSON array:`,
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

router.post("/projects/:id/generate", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const body = GenerateInputSchema.parse(req.body ?? {});
  const model = await getModel(projectId, body.model);
  const maxCommits = body.maxCommits ?? 50;

  await db
    .update(projectsTable)
    .set({ status: "indexing", updatedAt: new Date() })
    .where(eq(projectsTable.id, projectId));

  try {
    // Step 1: Fetch valid (signal-scored) commits
    const validCommits = await db
      .select()
      .from(commitsTable)
      .where(and(eq(commitsTable.projectId, projectId), eq(commitsTable.valid, true)))
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

    // Step 3: L1 Tagger
    const existingL1 = await db.select().from(l1TagsTable);
    const existingTagNames = existingL1.map((t) => t.name);
    const aiL1Tags = await generateL1Tags(commitData, existingTagNames, model);

    let l1TagsCreated = 0;
    const tagMap = new Map<string, number>();

    for (const existing of existingL1) {
      tagMap.set(existing.name.toLowerCase(), existing.id);
    }

    for (const tag of aiL1Tags) {
      const key = tag.name.toLowerCase();
      if (tagMap.has(key)) continue;
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

    // Step 4: L2 Extractor + L3 Generator (combined AI call)
    const allL1Tags = await db.select().from(l1TagsTable);
    const l2Input = await generateL2Nodes(commitData, allL1Tags, documentContext, model);

    let l2NodesCreated = 0;
    let l2NodesUpdated = 0;
    let l3NodesCreated = 0;
    let reviewTasksCreated = 0;

    // Build a hash → commit id map for commit→L2 backfill
    const commitHashMap = new Map<string, number>();
    for (const c of validCommits) {
      commitHashMap.set(c.hash.slice(0, 8), c.id);
      commitHashMap.set(c.hash, c.id);
    }

    // Fetch existing L2 nodes for this project (for deduplication)
    const existingL2 = await db
      .select()
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId));
    const existingL2Map = new Map<string, (typeof existingL2)[0]>();
    for (const node of existingL2) {
      existingL2Map.set(node.name.toLowerCase(), node);
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

      // Step 5: L3 nodes — insert + create review tasks for low-confidence nodes
      for (const l3data of l2data.l3Nodes ?? []) {
        const confidence =
          typeof l3data.confidence === "number"
            ? Math.max(0, Math.min(1, l3data.confidence))
            : 0.75;

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
          })
          .returning();
        l3NodesCreated++;

        // Generate and store embedding for the L3 node
        const l3EmbText = `${l3data.title} ${l3data.content ?? ""}`.trim();
        const l3Embedding = await generateEmbedding(l3EmbText);
        if (l3Embedding) {
          await db
            .update(l3NodesTable)
            .set({ embedding: JSON.stringify(l3Embedding) })
            .where(eq(l3NodesTable.id, l3node.id));
        }

        // Queue review task for L3 nodes with confidence below threshold
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

        // Step 6: Backfill commit → L2 link via commit hash
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
          }
        }
      }
    }

    // Create single L2 review tasks for newly created nodes (fix the scoping issue above)
    // Re-run to ensure all new L2 nodes get review tasks
    const newL2Count = l2NodesCreated;
    const postL2 = await db
      .select()
      .from(l2NodesTable)
      .where(and(eq(l2NodesTable.projectId, projectId), eq(l2NodesTable.needsReview, true)));
    // Count pending review tasks for l2_nodes to avoid double-creating
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
