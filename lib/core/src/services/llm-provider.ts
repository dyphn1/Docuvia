import { db } from "@workspace/db";
import { llmConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createLlmClient } from "@workspace/integrations-openai-ai-server";

export async function getLlmClientForProject(projectId?: number) {
  if (!projectId) {
    return { client: createLlmClient(), model: process.env.AI_OPENAI_FAST_MODEL || "gpt-5.2" };
  }

  const [config] = await db
    .select()
    .from(llmConfigsTable)
    .where(eq(llmConfigsTable.projectId, projectId))
    .limit(1);

  if (!config) {
    return { client: createLlmClient(), model: process.env.AI_OPENAI_FAST_MODEL || "gpt-5.2" };
  }

  return {
    client: createLlmClient({
      provider: config.provider,
      model: config.model,
    }),
    model: config.model || "gpt-5.2",
  };
}
