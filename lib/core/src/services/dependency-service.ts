import { db } from "@workspace/db";
import { l2NodesTable, nodeLinksTable } from "@workspace/db/schema";
import { and, eq, inArray, like } from "drizzle-orm";

export class DependencyService {
  public static async getDependencies(
    moduleName: string,
    escapedModuleName: string,
    projectId?: number
  ) {
    const nameFilter = like(l2NodesTable.name, `%${escapedModuleName}%`);
    const nodes = await db
      .select()
      .from(l2NodesTable)
      .where(projectId ? and(nameFilter, eq(l2NodesTable.projectId, projectId)) : nameFilter);

    const node = nodes[0];

    if (!node) {
      return { module: moduleName, nodeId: null, dependencies: [], dependents: [] };
    }

    const [outLinks, inLinks] = await Promise.all([
      db.select().from(nodeLinksTable).where(eq(nodeLinksTable.sourceNodeId, node.id)),
      db.select().from(nodeLinksTable).where(eq(nodeLinksTable.targetNodeId, node.id)),
    ]);

    const relatedNodeIds = [
      ...new Set([...outLinks.map((l) => l.targetNodeId), ...inLinks.map((l) => l.sourceNodeId)]),
    ];
    const relatedNodes = relatedNodeIds.length
      ? await db
          .select({ id: l2NodesTable.id, name: l2NodesTable.name })
          .from(l2NodesTable)
          .where(inArray(l2NodesTable.id, relatedNodeIds))
      : [];
    const nameById = new Map(relatedNodes.map((n) => [n.id, n.name]));

    const dependencies = outLinks.map(
      (link) => nameById.get(link.targetNodeId) ?? `node#${link.targetNodeId}`
    );
    const dependents = inLinks.map(
      (link) => nameById.get(link.sourceNodeId) ?? `node#${link.sourceNodeId}`
    );

    return { module: moduleName, nodeId: node.id, dependencies, dependents };
  }
}
