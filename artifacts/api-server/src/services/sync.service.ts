import { db } from "@workspace/db";
import { l2NodesTable, l3NodesTable, jobQueueTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { writeKnowledgeToOrphanBranch } from "@workspace/core";
import { logger } from "@workspace/core";

export class SyncService {
  async acquireProjectLock(projectId: number): Promise<boolean> {
    const lockAcquired = (await db.execute(
      sql`SELECT pg_try_advisory_xact_lock(${projectId}) as acquired`
    )) as any;

    return lockAcquired.rows ? lockAcquired.rows[0]?.acquired : lockAcquired[0]?.acquired;
  }

  async processEvents(projectId: number, events: any[]) {
    await db.transaction(async (tx) => {
      for (const ev of events) {
        if (ev.type === "CREATE_L3") {
          // Validate L2 node exists to prevent dangling references
          const payloadL2Id = Number(ev.payload.l2NodeId);
          const [l2] = await tx
            .select({ id: l2NodesTable.id })
            .from(l2NodesTable)
            .where(eq(l2NodesTable.id, payloadL2Id));
          if (!l2) throw new Error(`L2 Node ${payloadL2Id} does not exist`);

          await tx.insert(l3NodesTable).values(ev.payload as any);
        } else if (ev.type === "UPDATE_L3") {
          await tx
            .update(l3NodesTable)
            .set(ev.payload.data as any)
            .where(eq(l3NodesTable.id, Number(ev.payload.id)));
        }
        // ... (other handlers omitted for brevity)
      }

      // 3. Queue the Git Sync to outbox (Database-as-IPC) instead of running synchronously
      await tx.insert(jobQueueTable).values({
        taskType: "sync_orphan_branch",
        payload: { projectId },
        status: "pending",
      });
    });
  }
}
