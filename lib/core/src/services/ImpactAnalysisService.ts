import { db } from "@workspace/db";
import { l2NodesTable, l3NodesTable, nodeLinksTable } from "@workspace/db/schema";
import { eq, like, inArray, count } from "drizzle-orm";

export class ImpactAnalysisService {
  private static async collectTransitiveImpactingNodeIds(startNodeId: number): Promise<number[]> {
    const visited = new Set<number>();
    let frontier = [startNodeId];

    while (frontier.length > 0) {
      const links = await db
        .select({
          sourceNodeId: nodeLinksTable.sourceNodeId,
        })
        .from(nodeLinksTable)
        .where(inArray(nodeLinksTable.targetNodeId, frontier));

      const nextFrontier: number[] = [];
      for (const link of links) {
        if (!visited.has(link.sourceNodeId) && link.sourceNodeId !== startNodeId) {
          visited.add(link.sourceNodeId);
          nextFrontier.push(link.sourceNodeId);
        }
      }

      frontier = nextFrontier;
    }

    return [...visited];
  }

  public static async analyzeImpact(moduleName: string, escapedModuleName: string, projectId?: number) {
    const nodes = await db
      .select()
      .from(l2NodesTable)
      .where(like(l2NodesTable.name, `%${escapedModuleName}%`));
    
    const node = projectId ? nodes.find((n) => n.projectId === projectId) : nodes[0];

    if (!node) {
      return { module: moduleName, nodeId: null, impactedModules: [], l3DecisionCount: 0 };
    }

    const impactedNodeIds = await this.collectTransitiveImpactingNodeIds(node.id);
    const impactedNodes = impactedNodeIds.length
      ? await db
          .select({
            id: l2NodesTable.id,
            name: l2NodesTable.name,
          })
          .from(l2NodesTable)
          .where(inArray(l2NodesTable.id, impactedNodeIds))
      : [];
    
    const impactedNodeNameById = new Map(impactedNodes.map((n) => [n.id, n.name]));
    const impacted = impactedNodeIds.map((id) => impactedNodeNameById.get(id) ?? `node#${id}`);

    const [l3Row] = await db
      .select({ count: count() })
      .from(l3NodesTable)
      .where(inArray(l3NodesTable.l2NodeId, [node.id, ...impactedNodeIds]));

    return {
      module: moduleName,
      nodeId: node.id,
      impactedModules: impacted,
      l3DecisionCount: l3Row.count,
    };
  }
}
