import { IDirectLookupHandler } from "../../interfaces/intent-router.interfaces.js";
import { AgenticSearchResult } from "../../types/intent-router.types.js";
import { db } from "@workspace/db";
import { l2NodesTable, l3NodesTable } from "@workspace/db";
import { eq, like, or, sql } from "drizzle-orm";
import { applyTemporalDecay } from "./router.utils.js";
import { sanitizeLikeInput } from "../../utils/sql-utils.js";

export class DirectLookupService implements IDirectLookupHandler {
  async lookup(
    searchQuery: string,
    projectId?: number,
    limit = 20,
    includePending = false
  ): Promise<AgenticSearchResult[]> {
    const results: AgenticSearchResult[] = [];

    // Determine if it's a commit hash format
    const isHash = /^[0-9a-fA-F]{4,40}$/.test(searchQuery);

    if (isHash) {
      const l3Nodes = await db
        .select()
        .from(l3NodesTable)
        .where(like(l3NodesTable.introducedInCommit, `${searchQuery}%`))
        .limit(limit);

      for (const l3 of l3Nodes) {
        if (!includePending && l3.validityStatus !== "valid") continue;
        // Resolve project ID using subquery or simple fetch
        const [l2] = await db
          .select({ projectId: l2NodesTable.projectId })
          .from(l2NodesTable)
          .where(eq(l2NodesTable.id, l3.l2NodeId));
        if (projectId && l2?.projectId !== projectId) continue;

        results.push({
          source: "direct",
          nodeLayer: "l3",
          id: l3.id,
          title: l3.title,
          content: l3.content,
          projectId: l2?.projectId ?? 0,
          projectName: null,
          score: applyTemporalDecay(1.0, l3.lastVerifiedAt ?? l3.createdAt),
          createdAt: l3.createdAt.toISOString(),
        });
      }
    } else {
      // Full-text content search fallback
      const sanitizedQuery = sanitizeLikeInput(searchQuery);

      // We would ideally use Postgres Full Text Search (to_tsvector/to_tsquery)
      // but sticking to ILIKE for architectural continuity here.
      const l3Nodes = await db
        .select()
        .from(l3NodesTable)
        .where(
          or(
            sql`${l3NodesTable.title} ILIKE ${`%${sanitizedQuery}%`}`,
            sql`${l3NodesTable.content} ILIKE ${`%${sanitizedQuery}%`}`
          )
        )
        .limit(limit);

      for (const l3 of l3Nodes) {
        if (!includePending && l3.validityStatus !== "valid") continue;
        const [l2] = await db
          .select({ projectId: l2NodesTable.projectId })
          .from(l2NodesTable)
          .where(eq(l2NodesTable.id, l3.l2NodeId));
        if (projectId && l2?.projectId !== projectId) continue;

        results.push({
          source: "direct",
          nodeLayer: "l3",
          id: l3.id,
          title: l3.title,
          content: l3.content,
          projectId: l2?.projectId ?? 0,
          projectName: null,
          score: applyTemporalDecay(0.8, l3.lastVerifiedAt ?? l3.createdAt),
          createdAt: l3.createdAt.toISOString(),
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }
}
