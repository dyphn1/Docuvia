import { db } from "@workspace/db";
import {
  l1TagsTable,
  l2NodesTable,
  l2NodeL1TagsTable,
  l3NodesTable,
  commitsTable,
} from "@workspace/db";
import { eq, sql, count, inArray } from "drizzle-orm";
import { ProjectService } from "./project.service";
import { Writable } from "stream";

export class ExportService {
  async exportProjectToJson(projectId: number) {
    const project = await new ProjectService().getProjectById(projectId);
    if (!project) return null;

    const [l2CountRow] = await db
      .select({ count: count() })
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId));
    const l2Nodes = await db
      .select()
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, projectId))
      .orderBy(l2NodesTable.id);
    const l2Ids = l2Nodes.map((n) => n.id);

    const [[l3CountRow], [commitCountRow]] = await Promise.all([
      db
        .select({ count: count() })
        .from(l3NodesTable)
        .where(inArray(l3NodesTable.l2NodeId, l2Ids.length ? l2Ids : [0])),
      db.select({ count: count() }).from(commitsTable).where(eq(commitsTable.projectId, projectId)),
    ]);
    const l3Count = l2Ids.length ? l3CountRow.count : 0;

    const [tagLinkRows, l3Counts] = await Promise.all([
      l2Ids.length
        ? db.select().from(l2NodeL1TagsTable).where(inArray(l2NodeL1TagsTable.l2NodeId, l2Ids))
        : [],
      l2Ids.length
        ? db
            .select({ l2NodeId: l3NodesTable.l2NodeId, count: count() })
            .from(l3NodesTable)
            .where(inArray(l3NodesTable.l2NodeId, l2Ids))
            .groupBy(l3NodesTable.l2NodeId)
        : [],
    ]);
    const l3CountMap = new Map(l3Counts.map((r) => [r.l2NodeId, r.count]));
    const tagLinksByL2 = new Map<number, number[]>();
    for (const link of tagLinkRows) {
      const ids = tagLinksByL2.get(link.l2NodeId);
      if (ids) ids.push(link.l1TagId);
      else tagLinksByL2.set(link.l2NodeId, [link.l1TagId]);
    }
    const l2WithTags = l2Nodes.map((n) => ({
      ...n,
      l3Count: l3CountMap.get(n.id) ?? 0,
      l1TagIds: tagLinksByL2.get(n.id) ?? [],
      createdAt: n.createdAt.toISOString(),
    }));

    const l3Nodes = l2Ids.length
      ? await db.select().from(l3NodesTable).where(inArray(l3NodesTable.l2NodeId, l2Ids))
      : [];

    const commits = await db
      .select()
      .from(commitsTable)
      .where(eq(commitsTable.projectId, projectId))
      .orderBy(sql`${commitsTable.createdAt} desc`);

    const l1Tags = await db
      .select()
      .from(l1TagsTable)
      .orderBy(sql`${l1TagsTable.usageCount} desc`);

    const projectData = {
      ...project,
      l2Count: l2CountRow.count,
      l3Count,
      commitCount: commitCountRow.count,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };

    return {
      project: projectData,
      l1Tags: l1Tags.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
      l2Nodes: l2WithTags,
      l3Nodes: l3Nodes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
      commits: commits.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
      exportedAt: new Date().toISOString(),
    };
  }

  async exportProjectToMarkdownStream(projectId: number, stream: Writable) {
    const project = await new ProjectService().getProjectById(projectId);
    if (!project) return false;

    stream.write(`# Project: ${project.name}\n\n`);
    stream.write(`Repository: ${project.repoUrl ?? "N/A"}\n\n`);
    stream.write(`Exported at: ${new Date().toISOString()}\n\n`);

    stream.write(`## L2 Modules\n\n`);

    let offset = 0;
    const batchSize = 100;

    while (true) {
      const l2Nodes = await db
        .select()
        .from(l2NodesTable)
        .where(eq(l2NodesTable.projectId, projectId))
        .orderBy(l2NodesTable.id)
        .limit(batchSize)
        .offset(offset);

      if (l2Nodes.length === 0) break;

      const l2IdList = l2Nodes.map((n) => n.id);
      const allL3 = l2IdList.length
        ? await db.select().from(l3NodesTable).where(inArray(l3NodesTable.l2NodeId, l2IdList))
        : [];
      const l3ByL2 = new Map<number, typeof allL3>();
      for (const l3 of allL3) {
        const group = l3ByL2.get(l3.l2NodeId);
        if (group) group.push(l3);
        else l3ByL2.set(l3.l2NodeId, [l3]);
      }

      for (const l2 of l2Nodes) {
        stream.write(`### [L2] ${l2.name}\n`);
        stream.write(`**Type**: ${l2.type} | **Confirmed**: ${l2.isBootstrapConfirmed}\n\n`);
        if (l2.description) stream.write(`${l2.description}\n\n`);

        const l3Nodes = l3ByL2.get(l2.id) ?? [];
        for (const l3 of l3Nodes) {
          stream.write(`#### [L3] ${l3.title}\n`);
          stream.write(`- **Type**: ${l3.nodeType}\n`);
          stream.write(`- **Status**: ${l3.validityStatus}\n`);
          stream.write(`- **Introduced in**: \`${l3.introducedInCommit ?? "Unknown"}\`\n\n`);
          if (l3.content) stream.write(`${l3.content}\n\n`);
        }
      }

      offset += batchSize;
    }
    return project;
  }
}
