import { db } from "@workspace/db";
import { commitsTable, l3NodesTable } from "@workspace/db/schema";
import { like } from "drizzle-orm";

export class DecisionRecordService {
  public static async getDecisionRecord(commitHash: string, escapedCommitHash: string) {
    const [commit] = await db
      .select()
      .from(commitsTable)
      .where(like(commitsTable.hash, `${escapedCommitHash}%`));

    const l3Nodes = await db
      .select()
      .from(l3NodesTable)
      .where(like(l3NodesTable.commitHash, `${escapedCommitHash}%`));

    return {
      commitHash,
      commitMessage: commit?.message ?? null,
      decisions: l3Nodes.map((n) => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }
}
