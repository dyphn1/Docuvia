import { db } from "@workspace/db";
import { projectIntegrationsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export class IntegrationService {
  async getIntegrationsByProjectId(projectId: number) {
    return await db
      .select()
      .from(projectIntegrationsTable)
      .where(eq(projectIntegrationsTable.projectId, projectId));
  }

  async createIntegration(projectId: number, body: any) {
    const [created] = await db
      .insert(projectIntegrationsTable)
      .values({ projectId, ...body })
      .returning();
    return created;
  }

  async updateIntegration(integrationId: number, body: any) {
    const [updated] = await db
      .update(projectIntegrationsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(projectIntegrationsTable.id, integrationId))
      .returning();
    return updated;
  }

  async deleteIntegration(integrationId: number) {
    const [deleted] = await db
      .delete(projectIntegrationsTable)
      .where(eq(projectIntegrationsTable.id, integrationId))
      .returning();
    return deleted;
  }

  async getIntegrationById(integrationId: number) {
    const [integration] = await db
      .select()
      .from(projectIntegrationsTable)
      .where(eq(projectIntegrationsTable.id, integrationId));
    return integration;
  }

  async getProjectByIntegrationId(integrationId: number) {
    const integration = await this.getIntegrationById(integrationId);
    if (!integration) return null;

    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, integration.projectId));

    return project;
  }
}
