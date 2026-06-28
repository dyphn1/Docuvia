import { db } from "@workspace/db";
import { l2NodesTable, nodeLinksTable } from "@workspace/db/schema";
import { eq, like } from "drizzle-orm";

export class DependencyService {
  public static async getDependencies(
    moduleName: string,
    escapedModuleName: string,
    projectId?: number
  ) {
    const nodes = await db
      .select()
      .from(l2NodesTable)
      .where(like(l2NodesTable.name, `%${escapedModuleName}%`));

    const node = projectId ? nodes.find((n) => n.projectId === projectId) : nodes[0];

    if (!node) {
      return { module: moduleName, nodeId: null, dependencies: [], dependents: [] };
    }

    const outLinks = await db
      .select()
      .from(nodeLinksTable)
      .where(eq(nodeLinksTable.sourceNodeId, node.id));

    const inLinks = await db
      .select()
      .from(nodeLinksTable)
      .where(eq(nodeLinksTable.targetNodeId, node.id));

    const dependencies = await Promise.all(
      outLinks.map(async (link) => {
        const [target] = await db
          .select({ name: l2NodesTable.name })
          .from(l2NodesTable)
          .where(eq(l2NodesTable.id, link.targetNodeId));
        return target?.name ?? `node#${link.targetNodeId}`;
      })
    );

    const dependents = await Promise.all(
      inLinks.map(async (link) => {
        const [source] = await db
          .select({ name: l2NodesTable.name })
          .from(l2NodesTable)
          .where(eq(l2NodesTable.id, link.sourceNodeId));
        return source?.name ?? `node#${link.sourceNodeId}`;
      })
    );

    return { module: moduleName, nodeId: node.id, dependencies, dependents };
  }
}
