import { db } from "@workspace/db";
import { commitsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "../../utils/logger.js";
import { getLlmClientForProject } from "../llm-provider.js";
import { buildFewShotSection } from "../prompt-service.js";
import {
  ILlmGenerationService,
  L2NodeAI,
} from "../../interfaces/knowledge-generation.interfaces.js";

export class LlmGenerationService implements ILlmGenerationService {
  async condenseL3Node(
    projectId: number,
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
          const { client } = await getLlmClientForProject(projectId);
          const response = await client.chat.completions.create({
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

  async generateL1Tags(
    projectId: number,
    commits: Array<{ message: string; hash: string }>,
    existingTags: string[],
    model: string,
    systemPromptOverride: string
  ): Promise<Array<{ name: string; category: string; description: string }>> {
    const commitList = commits.map((c) => `- ${c.message}`).join("\n");
    const existing = existingTags.length
      ? `\nExisting global tags (reuse if applicable): ${existingTags.join(", ")}`
      : "";

    const { client } = await getLlmClientForProject(projectId);
    const response = await client.chat.completions.create({
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

  async generateL2Nodes(
    projectId: number,
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

    const { client } = await getLlmClientForProject(projectId);
    const response = await client.chat.completions.create({
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
}
