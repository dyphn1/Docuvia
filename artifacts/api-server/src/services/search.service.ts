import { db } from "@workspace/db";
import { l2NodesTable, l3NodesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export class SearchService {
  async processFeedback(
    nodeId: number,
    nodeLayer: "l1" | "l2" | "l3" | "commit",
    interactionType: string
  ) {
    if (nodeLayer === "l2") {
      await db
        .update(l2NodesTable)
        .set({ lastVerifiedAt: new Date() })
        .where(eq(l2NodesTable.id, nodeId));
    } else if (nodeLayer === "l3") {
      await db
        .update(l3NodesTable)
        .set({ lastVerifiedAt: new Date() })
        .where(eq(l3NodesTable.id, nodeId));
    }
    // L1 and commit not currently supported for direct verification bumps here
  }
}
