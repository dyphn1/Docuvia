import { IGraphTraversalHandler } from "../../interfaces/intent-router.interfaces.js";
import { AgenticSearchResult } from "../../types/intent-router.types.js";
import { db } from "@workspace/db";
import { l2NodesTable, l3NodesTable, projectsTable, nodeLinksTable } from "@workspace/db";
import { eq, like, sql } from "drizzle-orm";
import { applyTemporalDecay } from "./router.utils.js";
import { sanitizeLikeInput } from "../../utils/sql-utils.js";

export class GraphTraversalService implements IGraphTraversalHandler {
  async traverse(
    moduleName: string,
    projectId?: number,
    limit = 20
  ): Promise<AgenticSearchResult[]> {
    const results: AgenticSearchResult[] = [];

    const escapedModuleName = sanitizeLikeInput(moduleName);
    const nodes = await db
      .select()
      .from(l2NodesTable)
      .where(like(l2NodesTable.name, `%${escapedModuleName}%`));
    const node = projectId ? nodes.find((n) => n.projectId === projectId) : nodes[0];

    if (!node) return results;

    const [proj] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, node.projectId));

    results.push({
      source: "graph",
      nodeLayer: "l2",
      id: node.id,
      title: node.name,
      content: node.description ?? null,
      projectId: node.projectId,
      projectName: proj?.name ?? null,
      score: applyTemporalDecay(1.0, node.lastVerifiedAt ?? node.createdAt),
      createdAt: node.createdAt.toISOString(),
    });

    // Batch query for out-links
    const outLinks = await db
      .select()
      .from(nodeLinksTable)
      .where(eq(nodeLinksTable.sourceNodeId, node.id));

    if (outLinks.length > 0) {
      const targetIds = outLinks.map((l) => l.targetNodeId);
      const relatedL2s = await db
        .select()
        .from(l2NodesTable)
        .where(sql`${l2NodesTable.id} IN ${targetIds}`);

      for (const r of relatedL2s) {
        results.push({
          source: "graph",
          nodeLayer: "l2",
          id: r.id,
          title: r.name,
          content: `Related dependency of ${node.name}`,
          projectId: r.projectId,
          projectName: proj?.name ?? null,
          score: applyTemporalDecay(0.8, r.lastVerifiedAt ?? r.createdAt),
          createdAt: r.createdAt.toISOString(),
        });
      }
    }

    // Fetch L3 nodes associated with the seed node, sorted by validity and occurrence
    const l3Decisions = await db
      .select()
      .from(l3NodesTable)
      .where(eq(l3NodesTable.l2NodeId, node.id))
      .orderBy(sql`${l3NodesTable.occurrenceCount} DESC`)
      .limit(limit);

    for (const l3 of l3Decisions) {
      results.push({
        source: "graph",
        nodeLayer: "l3",
        id: l3.id,
        title: l3.title,
        content: l3.content,
        projectId: node.projectId,
        projectName: proj?.name ?? null,
        score: applyTemporalDecay(0.9, node.lastVerifiedAt ?? node.createdAt),
        createdAt: l3.createdAt.toISOString(),
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
