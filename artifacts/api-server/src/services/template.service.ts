import { db } from "@workspace/db";
import { promptTemplatesTable } from "@workspace/db";
import { eq, and, isNull, sql, desc } from "drizzle-orm";

export class TemplateService {
  async getTemplatesByProjectId(projectId: number) {
    return await db
      .select()
      .from(promptTemplatesTable)
      .where(eq(promptTemplatesTable.projectId, projectId));
  }

  async getTemplate(projectId: number, templateType: string) {
    const [existing] = await db
      .select()
      .from(promptTemplatesTable)
      .where(
        and(
          eq(promptTemplatesTable.projectId, projectId),
          eq(promptTemplatesTable.templateType, templateType as any)
        )
      );
    return existing;
  }

  async updateTemplate(id: number, systemPrompt: string) {
    const [updated] = await db
      .update(promptTemplatesTable)
      .set({ systemPrompt, updatedAt: new Date() })
      .where(eq(promptTemplatesTable.id, id))
      .returning();
    return updated;
  }

  async createTemplate(projectId: number, templateType: string, systemPrompt: string) {
    const [created] = await db
      .insert(promptTemplatesTable)
      .values({
        projectId,
        templateType: templateType as any,
        systemPrompt,
        isActive: true,
      })
      .returning();
    return created;
  }

  async deleteTemplate(projectId: number, templateType: string) {
    await db
      .delete(promptTemplatesTable)
      .where(
        and(
          eq(promptTemplatesTable.projectId, projectId),
          eq(promptTemplatesTable.templateType, templateType as any)
        )
      );
  }

  async checkUpgradeWarning(template: typeof promptTemplatesTable.$inferSelect) {
    if (!template.parentTemplateId) {
      return { hasUpgradeWarning: false };
    }
    const [parentTemplate] = await db
      .select()
      .from(promptTemplatesTable)
      .where(eq(promptTemplatesTable.id, template.parentTemplateId))
      .limit(1);

    if (!parentTemplate) {
      return { hasUpgradeWarning: false };
    }

    const parentProjectId = parentTemplate.projectId;
    const [newerParent] = await db
      .select()
      .from(promptTemplatesTable)
      .where(
        and(
          parentProjectId === null
            ? isNull(promptTemplatesTable.projectId)
            : eq(promptTemplatesTable.projectId, parentProjectId),
          eq(promptTemplatesTable.templateType, parentTemplate.templateType),
          sql`${promptTemplatesTable.version} > ${parentTemplate.version}`
        )
      )
      .orderBy(desc(promptTemplatesTable.version))
      .limit(1);

    if (newerParent) {
      return {
        hasUpgradeWarning: true,
        latestParentVersion: newerParent.version,
      };
    }

    return { hasUpgradeWarning: false };
  }
}
