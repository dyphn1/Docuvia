import { db } from "@workspace/db";
import { l3NodesTable, activityLogTable, l2NodesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CreateL3NodeBody, UpdateL3NodeBody } from "@workspace/api-zod";
import { z } from "zod";

export class L3NodesService {
  async getNodesByL2Id(l2NodeId: number) {
    return db
      .select()
      .from(l3NodesTable)
      .where(eq(l3NodesTable.l2NodeId, l2NodeId))
      .orderBy(sql`${l3NodesTable.createdAt} desc`);
  }

  async createNode(l2NodeId: number, body: z.infer<typeof CreateL3NodeBody>) {
    const [node] = await db
      .insert(l3NodesTable)
      .values({
        l2NodeId,
        title: body.title,
        content: body.content ?? null,
        nodeType: body.nodeType as any,
        commitHash: body.commitHash ?? null,
        aiGenerated: body.aiGenerated ?? true,
        confidence: body.confidence ?? null,
      })
      .returning();

    const [l2] = await db.select().from(l2NodesTable).where(eq(l2NodesTable.id, l2NodeId));
    await db.insert(activityLogTable).values({
      type: "l3_created",
      description: `L3 node "${node.title}" created`,
      projectId: l2?.projectId ?? null,
    });

    return node;
  }

  async updateNode(id: number, body: z.infer<typeof UpdateL3NodeBody>) {
    const [node] = await db
      .update(l3NodesTable)
      .set(body as any)
      .where(eq(l3NodesTable.id, id))
      .returning();
    return node;
  }

  async deleteNode(id: number) {
    await db.delete(l3NodesTable).where(eq(l3NodesTable.id, id));
  }
}

export const l3NodesService = new L3NodesService();
