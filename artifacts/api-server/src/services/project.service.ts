import { db } from "@workspace/db";
import {
  projectsTable,
  l1TagsTable,
  l2NodeL1TagsTable,
  l2NodesTable,
  l3NodesTable,
  nodeLinksTable,
  commitsTable,
  activityLogTable,
} from "@workspace/db";
import { eq, inArray, count, sql } from "drizzle-orm";
import { LocalGitClient, processIngestion, logger } from "@workspace/core";
import type { z } from "zod";
import { CreateProjectBody, UpdateProjectBody, CreateCommitBody } from "@workspace/api-zod";

export class ProjectService {
  async listProjects() {
    const projects = await db
      .select()
      .from(projectsTable)
      .orderBy(sql`${projectsTable.updatedAt} desc`);
    const result = await Promise.all(
      projects.map(async (p) => {
        const [l2CountRow] = await db
          .select({ count: count() })
          .from(l2NodesTable)
          .where(eq(l2NodesTable.projectId, p.id));
        const l2Ids = await db
          .select({ id: l2NodesTable.id })
          .from(l2NodesTable)
          .where(eq(l2NodesTable.projectId, p.id));
        let l3Count = 0;
        for (const { id } of l2Ids) {
          const [row] = await db
            .select({ count: count() })
            .from(l3NodesTable)
            .where(eq(l3NodesTable.l2NodeId, id));
          l3Count += row.count;
        }
        const [commitCountRow] = await db
          .select({ count: count() })
          .from(commitsTable)
          .where(eq(commitsTable.projectId, p.id));
        return {
          ...p,
          l2Count: l2CountRow.count,
          l3Count,
          commitCount: commitCountRow.count,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        };
      })
    );
    return result;
  }

  async createProject(body: z.infer<typeof CreateProjectBody>) {
    const [project] = await db
      .insert(projectsTable)
      .values({
        name: body.name,
        repoUrl: body.repoUrl,
        description: body.description ?? null,
        status: "active",
      })
      .returning();

    // Create default sys-uncategorized node
    await db.insert(l2NodesTable).values({
      projectId: project.id,
      name: "System: Uncategorized",
      type: "sys-uncategorized",
      isSystem: true,
      description: "Default bucket for unassigned L3 decisions",
      aiGenerated: false,
    });

    await db.insert(activityLogTable).values({
      type: "l2_created",
      description: `Project "${project.name}" added`,
      projectId: project.id,
    });
    return {
      ...project,
      l2Count: 1,
      l3Count: 0,
      commitCount: 0,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  async getProject(id: number) {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) return null;
    const [l2CountRow] = await db
      .select({ count: count() })
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, id));
    const l2Ids = await db
      .select({ id: l2NodesTable.id })
      .from(l2NodesTable)
      .where(eq(l2NodesTable.projectId, id));
    let l3Count = 0;
    for (const { nodeId } of l2Ids as any[]) {
      const lid = nodeId ?? (l2Ids[0] as any).id;
      const [row] = await db
        .select({ count: count() })
        .from(l3NodesTable)
        .where(eq(l3NodesTable.l2NodeId, lid));
      l3Count += row.count;
    }
    const [commitCountRow] = await db
      .select({ count: count() })
      .from(commitsTable)
      .where(eq(commitsTable.projectId, id));
    return {
      ...project,
      l2Count: l2CountRow.count,
      l3Count,
      commitCount: commitCountRow.count,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  async updateProject(id: number, body: z.infer<typeof UpdateProjectBody>) {
    const [project] = await db
      .update(projectsTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(projectsTable.id, id))
      .returning();
    if (!project) return null;
    return {
      ...project,
      l2Count: 0,
      l3Count: 0,
      commitCount: 0,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }

  async deleteProject(id: number) {
    await db.delete(projectsTable).where(eq(projectsTable.id, id));
  }

  async getProjectGraph(id: number) {
    const l2Nodes = await db.select().from(l2NodesTable).where(eq(l2NodesTable.projectId, id));
    const l2NodeIds = l2Nodes.map((n) => n.id);

    const l1Relations = l2NodeIds.length
      ? await db
          .select()
          .from(l2NodeL1TagsTable)
          .where(inArray(l2NodeL1TagsTable.l2NodeId, l2NodeIds))
      : [];

    const l1TagIds = Array.from(new Set(l1Relations.map((r) => r.l1TagId)));

    const l1Tags = l1TagIds.length
      ? await db.select().from(l1TagsTable).where(inArray(l1TagsTable.id, l1TagIds))
      : [];

    const l3Nodes = l2Nodes.length
      ? await db.select().from(l3NodesTable).where(inArray(l3NodesTable.l2NodeId, l2NodeIds))
      : [];

    const nodeLinks = l2Nodes.length
      ? await db
          .select()
          .from(nodeLinksTable)
          .where(inArray(nodeLinksTable.sourceNodeId, l2NodeIds))
      : [];

    return {
      projectId: id,
      l1Tags: l1Tags.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
      l2Nodes: l2Nodes.map((n) => ({
        ...n,
        l3Count: l3Nodes.filter((l3) => l3.l2NodeId === n.id).length,
        l1TagIds: l1Relations.filter((r) => r.l2NodeId === n.id).map((r) => r.l1TagId),
        createdAt: n.createdAt.toISOString(),
      })),
      l3Nodes: l3Nodes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
      nodeLinks: nodeLinks.map((nl) => ({
        id: nl.id,
        sourceNodeId: nl.sourceNodeId,
        targetNodeId: nl.targetNodeId,
        linkType: nl.linkType,
      })),
    };
  }

  async listProjectCommits(id: number) {
    const commits = await db
      .select()
      .from(commitsTable)
      .where(eq(commitsTable.projectId, id))
      .orderBy(sql`${commitsTable.createdAt} desc`);
    return commits.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }));
  }

  async createProjectCommit(id: number, body: z.infer<typeof CreateCommitBody>) {
    const [commit] = await db
      .insert(commitsTable)
      .values({
        projectId: id,
        hash: body.hash,
        message: body.message,
        author: body.author,
        valid: body.valid ?? true,
        l2NodeId: body.l2NodeId ?? null,
      })
      .returning();
    await db.insert(activityLogTable).values({
      type: "commit",
      description: `Commit ${commit.hash.slice(0, 8)}: ${commit.message}`,
      projectId: id,
    });
    return { ...commit, createdAt: commit.createdAt.toISOString() };
  }

  async listProjectL2Nodes(id: number) {
    const nodes = await db.select().from(l2NodesTable).where(eq(l2NodesTable.projectId, id));
    const result = await Promise.all(
      nodes.map(async (n) => {
        const [row] = await db
          .select({ count: count() })
          .from(l3NodesTable)
          .where(eq(l3NodesTable.l2NodeId, n.id));
        return { ...n, l3Count: row.count, l1TagIds: [], createdAt: n.createdAt.toISOString() };
      })
    );
    return result;
  }

  async syncProject(id: number) {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) return { error: "Project not found", status: 404 };

    if (project.vcsType !== "git") {
      return { error: "Sync is only supported for git projects", status: 400 };
    }

    let client = new LocalGitClient(project.repoUrl);
    try {
      await client.clone();
      const since = project.lastGitIngestedAt ?? undefined;
      const commits = await client.getCommits(500, since);

      if (commits.length === 0) {
        await db.insert(activityLogTable).values({
          projectId: id,
          type: "commit",
          description: "Sync triggered — no new commits found",
        });
        return { success: true, ingested: 0, message: "No new commits to ingest" };
      }

      const items = commits.map((c) => ({
        sha: c.sha,
        message: c.message,
        author: c.author,
        date: c.date,
      }));

      const { ingested, skipped, errors } = await processIngestion({
        type: "git",
        projectId: id,
        projectName: project.name,
        items,
      });

      await db
        .update(projectsTable)
        .set({ lastGitIngestedAt: new Date() })
        .where(eq(projectsTable.id, id));

      await db.insert(activityLogTable).values({
        projectId: id,
        type: "commit",
        description: `Sync: ingested ${ingested} commits, skipped ${skipped}`,
      });

      const message =
        errors.length > 0
          ? `Sync completed with ${errors.length} errors`
          : `Sync completed: ${ingested} commits ingested`;

      return { success: true, ingested, skipped, errors, message };
    } catch (err: any) {
      logger.error({ err, projectId: id }, "[POST /projects/:id/sync] Failed to trigger sync");
      return { error: `Sync failed: ${err.message}`, status: 500 };
    } finally {
      await client.cleanup();
    }
  }

  async getProjectById(projectId: number) {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    return project;
  }
}
