import { db } from "@workspace/db";
import { llmConfigsTable, promptTemplatesTable, correctionExamplesTable } from "@workspace/db";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { DEFAULT_PROMPTS } from "../utils/prompts.js";

export async function getPromptTemplate(projectId: number, templateType: string): Promise<string> {
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

export async function getModel(projectId: number, override?: string): Promise<string> {
  if (override) return override;
  const [cfg] = await db
    .select()
    .from(llmConfigsTable)
    .where(eq(llmConfigsTable.projectId, projectId));
  return cfg?.model ?? "gpt-5.2";
}

export async function getRecentCorrections(
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

export function buildFewShotSection(
  corrections: Array<{ original: string; corrected: string }>
): string {
  if (corrections.length === 0) return "";
  const examples = corrections
    .map((c, i) => `Example ${i + 1}:\n  Original: "${c.original}"\n  Corrected: "${c.corrected}"`)
    .join("\n");
  return `\n\nPrevious human corrections (use these as quality guidance):\n${examples}`;
}
