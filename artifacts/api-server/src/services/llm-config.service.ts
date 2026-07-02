import { db } from "@workspace/db";
import { llmConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export class LlmConfigService {
  async getConfigByProjectId(projectId: number) {
    const [cfg] = await db
      .select()
      .from(llmConfigsTable)
      .where(eq(llmConfigsTable.projectId, projectId));
    return cfg;
  }

  async createConfig(projectId: number, provider: string, model: string) {
    const [cfg] = await db
      .insert(llmConfigsTable)
      .values({
        projectId,
        provider,
        model,
        isDefault: false,
      })
      .returning();
    return cfg;
  }

  async updateConfig(id: number, data: Partial<typeof llmConfigsTable.$inferInsert>) {
    const [cfg] = await db
      .update(llmConfigsTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(llmConfigsTable.id, id))
      .returning();
    return cfg;
  }

  async getOrCreateConfig(projectId: number, defaultProvider = "openai", defaultModel = "gpt-5.2") {
    let cfg = await this.getConfigByProjectId(projectId);
    if (!cfg) {
      cfg = await this.createConfig(projectId, defaultProvider, defaultModel);
    }
    return cfg;
  }
}
