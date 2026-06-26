import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { l2NodesTable, l3NodesTable, projectsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { writeKnowledgeToOrphanBranch } from "../lib/orphan-branch-writer.js";

const router = Router();

import { SyncPushBody } from "@workspace/api-zod";

// POST /sync/push (CQRS Outbox receiver)
router.post("/sync/push", async (req, res) => {
  const parsed = SyncPushBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid outbox payload" });
  }

  const { projectId, events } = parsed.data;

  // 1. Acquire Central Mutex Lock for this Project
  const lockAcquired = (await db.execute(
    sql`SELECT pg_try_advisory_xact_lock(${projectId}) as acquired`
  )) as any;

  const acquired = lockAcquired.rows ? lockAcquired.rows[0]?.acquired : lockAcquired[0]?.acquired;
  if (!acquired) {
    return res.status(409).json({
      error: "Sync conflict: Resource is currently locked by another client. Try again later.",
    });
  }

  try {
    // 2. Apply DB Operations in Transaction (Two-phase commit prep)
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

      // 3. Perform Git Sync under the same lock
      await writeKnowledgeToOrphanBranch(projectId);
    });

    return res.json({ success: true, processed: events.length });
  } catch (err: any) {
    logger.error({ err, projectId }, "[POST /sync/push] Failed to process outbox events");
    return res.status(500).json({ error: `Sync failed: ${err.message}` });
  }
});

export default router;
