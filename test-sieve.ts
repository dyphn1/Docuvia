const SieveExtractionInputSchema = z.object({
  sourceText: z.string(),
  sourceFile: z.string().optional(),
  commitHash: z.string().optional(),
});

async function runSieveModel(
  sourceFile: string | undefined,
  commitHash: string | undefined,
  textToEmbed: string,
  l2Nodes: typeof l2NodesTable.$inferSelect[],
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
    const links = await db.select().from(commitL2LinksTable).where(eq(commitL2LinksTable.commitHash, commitHash));
    commitLinkedNodeIds = links.map((l: any) => l.l2NodeId);
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

    const totalScore = (scoreW1 * W1) + (scoreW2 * W2) + (scoreW3 * W3) + (scoreW4 * W4);
    if (totalScore > bestScore && totalScore > 0.4) {
      bestScore = totalScore;
      bestNodeId = node.id;
    }
  }

  return {
    bestNodeId,
    confidence: bestScore > 0 ? bestScore : 0.1
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
  const sysUncatNode = l2Nodes.find(n => n.type === "sys-uncategorized");
  const sysUncategorizedId = sysUncatNode?.id ?? 0;

  const model = await getModel(projectId);
  const systemPrompt = await getSystemPrompt(projectId, "l3_generator");

  let extracted: any[] = [];
  try {
    const response = await openai.chat.completions.create({
      model,
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Extract architecture decisions from this text as a JSON array of objects with 'title' and 'nodeType' (change|rule|decision|context):\n\n${sourceText}` }
      ]
    });
    const content = response.choices[0]?.message?.content ?? "[]";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.error({ err }, "Extraction failed");
    return res.status(500).json({ error: "Failed to extract decisions" });
  }

  const decisions = await Promise.all(extracted.map(async (dec) => {
    const textToEmbed = `${dec.title}\n${dec.nodeType}`;
    let l2NodeId = sysUncategorizedId;
    let confidence = 0.1;

    if (isTrackA) {
      const { bestNodeId, confidence: conf } = await runSieveModel(sourceFile, commitHash, textToEmbed, l2Nodes, sysUncategorizedId);
      l2NodeId = bestNodeId;
      confidence = conf;
    } else {
      // Track B: fallback to sys-uncategorized initially, then use Sieve to suggest
      const { bestNodeId, confidence: conf } = await runSieveModel(undefined, commitHash, textToEmbed, l2Nodes, sysUncategorizedId);
      l2NodeId = bestNodeId; // Return suggestion
      confidence = conf * 0.8; // Lower confidence for bulk
    }

    return {
      l2NodeId,
      title: dec.title || "Unknown Decision",
      nodeType: dec.nodeType || "context",
      confidence,
      noiseScore: 0.1
    };
  }));

  res.json({ decisions });
});
