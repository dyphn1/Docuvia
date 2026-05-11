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
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { z } from "zod";

const router = Router();

const GenerateInputSchema = z.object({
  model: z.string().optional(),
  maxCommits: z.number().optional().default(50),
});

async function getModel(projectId: number, override?: string): Promise<string> {
  if (override) return override;
  const [cfg] = await db.select().from(llmConfigsTable).where(eq(llmConfigsTable.projectId, projectId));
  return cfg?.model ?? "gpt-5.2";
}

async function generateL1Tags(commits: Array<{ message: string; hash: string }>, existingTags: string[], model: string): Promise<Array<{ name: string; category: string; description: string }>> {
  const commitList = commits.map(c => `- ${c.message}`).join("\n");
  const existing = existingTags.length ? `\nExisting global tags (reuse if applicable): ${existingTags.join(", ")}` : "";

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
Generate 3-8 tags that best represent the commit themes. Prefer reusing existing tags when they match.${existing}`
      },
      {
        role: "user",
        content: `Commits:\n${commitList}\n\nGenerate L1 tags as JSON array:`
      }
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

async function generateL2Nodes(
  commits: Array<{ message: string; hash: string }>,
  l1Tags: Array<{ id: number; name: string }>,
  model: string
): Promise<Array<{ name: string; type: "package" | "module" | "pcd"; description: string; l1TagNames: string[]; l3Nodes: Array<{ title: string; nodeType: "change" | "rule" | "decision" | "context"; content: string; commitHash: string }> }>> {
  const commitList = commits.map(c => `[${c.hash.slice(0, 8)}] ${c.message}`).join("\n");
  const tagNames = l1Tags.map(t => t.name).join(", ");

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

Available L1 tags to map L2 nodes to: ${tagNames}

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
      "commitHash": "hash from [xxxxx] prefix"
    }
  ]
}

Generate 2-6 L2 nodes with 1-3 L3 nodes each.`
      },
      {
        role: "user",
        content: `Commits to analyze:\n${commitList}\n\nGenerate L2/L3 knowledge nodes as JSON array:`
      }
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

  await db.update(projectsTable).set({ status: "indexing", updatedAt: new Date() }).where(eq(projectsTable.id, projectId));

  try {
    const validCommits = await db.select()
      .from(commitsTable)
      .where(and(eq(commitsTable.projectId, projectId), eq(commitsTable.valid, true)))
      .orderBy(sql`${commitsTable.createdAt} desc`)
      .limit(maxCommits);

    if (!validCommits.length) {
      await db.update(projectsTable).set({ status: "active", updatedAt: new Date() }).where(eq(projectsTable.id, projectId));
      return res.json({ l1TagsCreated: 0, l2NodesCreated: 0, l3NodesCreated: 0, reviewTasksCreated: 0, commitsProcessed: 0 });
    }

    const commitData = validCommits.map(c => ({ message: c.message, hash: c.hash }));

    const existingL1 = await db.select({ name: l1TagsTable.name }).from(l1TagsTable);
    const existingTagNames = existingL1.map(t => t.name);

    const aiL1Tags = await generateL1Tags(commitData, existingTagNames, model);

    let l1TagsCreated = 0;
    const tagMap = new Map<string, number>();

    for (const existing of existingL1) {
      const [row] = await db.select().from(l1TagsTable).where(eq(l1TagsTable.name, existing.name));
      if (row) tagMap.set(existing.name.toLowerCase(), row.id);
    }

    for (const tag of aiL1Tags) {
      const key = tag.name.toLowerCase();
      if (tagMap.has(key)) continue;
      try {
        const [created] = await db.insert(l1TagsTable).values({
          name: tag.name,
          category: tag.category ?? "Feature",
          description: tag.description,
          isAnchored: false,
        }).returning();
        tagMap.set(key, created.id);
        l1TagsCreated++;
      } catch {
        const [existing] = await db.select().from(l1TagsTable).where(eq(l1TagsTable.name, tag.name));
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

    const allL1Tags = await db.select().from(l1TagsTable);
    const l2Input = await generateL2Nodes(commitData, allL1Tags, model);

    let l2NodesCreated = 0;
    let l3NodesCreated = 0;
    let reviewTasksCreated = 0;

    for (const l2data of l2Input) {
      const [l2node] = await db.insert(l2NodesTable).values({
        projectId,
        name: l2data.name,
        type: l2data.type ?? "module",
        description: l2data.description,
        aiGenerated: true,
        needsReview: true,
      }).returning();
      l2NodesCreated++;

      for (const tagName of (l2data.l1TagNames ?? [])) {
        const tagId = tagMap.get(tagName.toLowerCase()) ?? allL1Tags.find(t => t.name.toLowerCase() === tagName.toLowerCase())?.id;
        if (tagId) {
          await db.insert(l2NodeL1TagsTable).values({ l2NodeId: l2node.id, l1TagId: tagId }).catch(() => {});
          await db.update(l1TagsTable).set({ usageCount: sql`${l1TagsTable.usageCount} + 1` }).where(eq(l1TagsTable.id, tagId));
        }
      }

      await db.insert(reviewTasksTable).values({
        entityType: "l2_node",
        entityId: l2node.id,
        taskType: "validate",
        status: "pending",
        description: `AI-generated L2 node: "${l2data.name}" — verify this component classification is accurate`,
      });
      reviewTasksCreated++;

      for (const l3data of (l2data.l3Nodes ?? [])) {
        await db.insert(l3NodesTable).values({
          l2NodeId: l2node.id,
          title: l3data.title,
          content: l3data.content,
          nodeType: l3data.nodeType ?? "change",
          commitHash: l3data.commitHash || null,
          aiGenerated: true,
          confidence: 0.75,
        });
        l3NodesCreated++;
      }
    }

    if (l2NodesCreated > 0) {
      await db.insert(activityLogTable).values({
        type: "l2_created",
        description: `AI generated ${l2NodesCreated} L2 nodes, ${l3NodesCreated} L3 nodes for "${project.name}"`,
        projectId,
      });
    }

    await db.update(projectsTable).set({ status: "active", updatedAt: new Date() }).where(eq(projectsTable.id, projectId));

    res.json({
      l1TagsCreated,
      l2NodesCreated,
      l3NodesCreated,
      reviewTasksCreated,
      commitsProcessed: validCommits.length,
    });
  } catch (err) {
    await db.update(projectsTable).set({ status: "error", updatedAt: new Date() }).where(eq(projectsTable.id, projectId));
    throw err;
  }
});

export default router;
