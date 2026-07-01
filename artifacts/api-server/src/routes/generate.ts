import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, l2NodesTable, l3NodesTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { generateEmbedding } from "@workspace/core";
import { logger } from "@workspace/core";
import { requireApiKey } from "../middlewares/auth.js";
import { z } from "zod";

import { GenerateKnowledgeBody } from "@workspace/api-zod";
import {
  executeKnowledgeGeneration,
  runSieveModel,
  getPromptTemplate,
  getModel,
  getLlmClientForProject,
} from "@workspace/core";

const router = Router();

const SieveExtractionInputSchema = z.object({
  sourceText: z.string(),
  sourceFile: z.string().optional(),
  commitHash: z.string().optional(),
});

router.post("/projects/:id/extract/sieve", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const bodyParsed = SieveExtractionInputSchema.safeParse(req.body ?? {});
  if (!bodyParsed.success) return res.status(400).json({ error: "Invalid input" });

  const { sourceText, sourceFile, commitHash } = bodyParsed.data;

  const isTrackA = !!sourceFile && !sourceFile.includes(",");

  const l2Nodes = await db.select().from(l2NodesTable).where(eq(l2NodesTable.projectId, projectId));
  const sysUncatNode = l2Nodes.find((n) => n.type === "sys-uncategorized");
  const sysUncategorizedId = sysUncatNode?.id ?? 0;

  const model = await getModel(projectId);
  const systemPrompt = await getPromptTemplate(projectId, "l3_generator");

  let extracted: any[] = [];
  try {
    const { client } = await getLlmClientForProject(projectId);
    const response = await client.chat.completions.create({
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
          projectId,
          sourceFile,
          commitHash,
          textToEmbed,
          l2Nodes,
          sysUncategorizedId
        );
        l2NodeId = bestNodeId;
        confidence = conf;
      } else {
        const { bestNodeId, confidence: conf } = await runSieveModel(
          projectId,
          undefined,
          commitHash,
          textToEmbed,
          l2Nodes,
          sysUncategorizedId
        );
        l2NodeId = bestNodeId;
        confidence = conf * 0.8;
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

router.post("/projects/:id/generate", requireApiKey, async (req, res) => {
  const projectId = Number(req.params.id);
  const body = GenerateKnowledgeBody.parse(req.body ?? {});

  try {
    const result = await executeKnowledgeGeneration(projectId, (req as any).user?.id, body);
    return res.json(result);
  } catch (err: any) {
    if (err.message === "Project not found") {
      return res.status(404).json({ error: err.message });
    }
    if (err.message === "Forbidden: Not project owner") {
      return res.status(403).json({ error: err.message });
    }
    if (err.message === "Project is already indexing or not in active state.") {
      return res.status(409).json({ error: err.message });
    }
    logger.error({ err }, "Knowledge generation failed");
    return res.status(500).json({ error: "Failed to generate knowledge" });
  }
});

router.post("/admin/reindex-embeddings", async (req, res) => {
  const l2Nodes = await db.select().from(l2NodesTable).where(isNull(l2NodesTable.embedding));
  let l2Done = 0;
  for (const node of l2Nodes) {
    const text = `${node.name} ${node.description ?? ""}`.trim();
    const emb = await generateEmbedding(node.projectId, text);
    if (emb) {
      await db.update(l2NodesTable).set({ embedding: emb }).where(eq(l2NodesTable.id, node.id));
      l2Done++;
    }
  }

  const l3Nodes = await db
    .select({
      id: l3NodesTable.id,
      title: l3NodesTable.title,
      content: l3NodesTable.content,
      projectId: l2NodesTable.projectId,
    })
    .from(l3NodesTable)
    .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
    .where(isNull(l3NodesTable.embedding));

  let l3Done = 0;
  for (const node of l3Nodes) {
    const text = `${node.title} ${node.content ?? ""}`.trim();
    const emb = await generateEmbedding(node.projectId, text);
    if (emb) {
      await db.update(l3NodesTable).set({ embedding: emb }).where(eq(l3NodesTable.id, node.id));
      l3Done++;
    }
  }

  res.json({ l2Reindexed: l2Done, l3Reindexed: l3Done });
});

export default router;
