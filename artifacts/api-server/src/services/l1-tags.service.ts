import { db } from "@workspace/db";
import { l1TagsTable, activityLogTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CreateL1TagBody, UpdateL1TagBody } from "@workspace/api-zod";
import { z } from "zod";

export class L1TagsService {
  async getAllTags() {
    return db
      .select()
      .from(l1TagsTable)
      .orderBy(sql`${l1TagsTable.usageCount} desc`);
  }

  async createTag(body: z.infer<typeof CreateL1TagBody>) {
    const [tag] = await db
      .insert(l1TagsTable)
      .values({
        name: body.name,
        category: body.category,
        description: body.description ?? null,
        isAnchored: body.isAnchored ?? false,
      })
      .returning();
    await db.insert(activityLogTable).values({
      type: "tag_added",
      description: `L1 tag "${tag.name}" added to pool`,
    });
    return tag;
  }

  async updateTag(id: number, body: z.infer<typeof UpdateL1TagBody>) {
    const [tag] = await db
      .update(l1TagsTable)
      .set(body)
      .where(eq(l1TagsTable.id, id))
      .returning();
    return tag;
  }

  async deleteTag(id: number) {
    await db.delete(l1TagsTable).where(eq(l1TagsTable.id, id));
  }
}

export const l1TagsService = new L1TagsService();
