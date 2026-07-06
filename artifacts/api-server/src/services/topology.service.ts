import { db } from "@workspace/db";
import {
  l1TagsTable,
  l2NodesTable,
  l2NodeL1TagsTable,
  l3NodesTable,
  nodeLinksTable,
} from "@workspace/db";
import { eq, ne, inArray, and } from "drizzle-orm";
import { buildTopologyGraph, TopologyExportOptions, TopologyGraph } from "@workspace/core";
import { ProjectService } from "./project.service";

export class TopologyService {
  /**
   * Server-side (PostgreSQL) twin of lib/core's TopologyExportService: fetches a
   * project's graph rows and delegates to the shared buildTopologyGraph so both
   * storage backends emit the identical versioned topology contract.
   */
  async getProjectTopology(
    projectId: number,
    options: TopologyExportOptions = {}
  ): Promise<TopologyGraph | null> {
    const project = await new ProjectService().getProjectById(projectId);
    if (!project) return null;

    const l2Rows = await db
      .select({
        id: l2NodesTable.id,
        name: l2NodesTable.name,
        pathPatterns: l2NodesTable.pathPatterns,
      })
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId));
    const l2Ids = l2Rows.map((row) => row.id);

    const [linkRows, l3Rows, tagRows] = l2Ids.length
      ? await Promise.all([
          // node_links carries no projectId; scoping the source to this project's
          // nodes is enough — cross-project targets are dropped by the builder's
          // dangling-link filter.
          db
            .select({
              sourceNodeId: nodeLinksTable.sourceNodeId,
              targetNodeId: nodeLinksTable.targetNodeId,
              linkType: nodeLinksTable.linkType,
            })
            .from(nodeLinksTable)
            .where(inArray(nodeLinksTable.sourceNodeId, l2Ids)),
          db
            .select({
              id: l3NodesTable.id,
              l2NodeId: l3NodesTable.l2NodeId,
              title: l3NodesTable.title,
            })
            .from(l3NodesTable)
            .where(
              and(inArray(l3NodesTable.l2NodeId, l2Ids), ne(l3NodesTable.validityStatus, "invalid"))
            ),
          db
            .select({
              l2NodeId: l2NodeL1TagsTable.l2NodeId,
              name: l1TagsTable.name,
            })
            .from(l2NodeL1TagsTable)
            .innerJoin(l1TagsTable, eq(l1TagsTable.id, l2NodeL1TagsTable.l1TagId))
            .where(inArray(l2NodeL1TagsTable.l2NodeId, l2Ids)),
        ])
      : [[], [], []];

    return buildTopologyGraph(
      {
        workspaceRoot: project.repoUrl || project.name,
        l2Rows: l2Rows.map((row) => ({
          id: row.id,
          name: row.name,
          filePath: firstPathPattern(row.pathPatterns),
        })),
        linkRows,
        l3Rows,
        tagRows,
      },
      options
    );
  }
}

function firstPathPattern(raw: unknown): string | undefined {
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return undefined;
}
