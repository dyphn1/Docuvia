import { db } from "@workspace/db";
import {
  pullRequestsTable,
  l2NodesTable,
  l3NodesTable,
  commitsTable,
  projectsTable,
} from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { getLlmOrchestratorForProject } from "@workspace/core";

export class PullRequestService {
  async getPullRequestsByProjectId(projectId: number) {
    return await db
      .select()
      .from(pullRequestsTable)
      .where(eq(pullRequestsTable.projectId, projectId))
      .orderBy(sql`${pullRequestsTable.createdAt} desc`);
  }

  async getPullRequest(projectId: number, prNumber: number) {
    const [pr] = await db
      .select()
      .from(pullRequestsTable)
      .where(
        and(
          eq(pullRequestsTable.projectId, projectId),
          eq(pullRequestsTable.githubPrNumber, prNumber)
        )
      );
    return pr;
  }

  async getCommitsAfterPr(projectId: number, prCreatedAt: Date) {
    return await db
      .select({ hash: commitsTable.hash })
      .from(commitsTable)
      .where(and(eq(commitsTable.projectId, projectId), gte(commitsTable.createdAt, prCreatedAt)));
  }

  async getL3NodesByProjectId(projectId: number) {
    return await db
      .select({
        id: l3NodesTable.id,
        title: l3NodesTable.title,
        nodeType: l3NodesTable.nodeType,
        content: l3NodesTable.content,
        commitHash: l3NodesTable.commitHash,
        l2NodeId: l3NodesTable.l2NodeId,
        createdAt: l3NodesTable.createdAt,
      })
      .from(l3NodesTable)
      .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
      .where(eq(l2NodesTable.projectId, projectId));
  }

  async getL2NodesByIds(projectId: number, l2NodeIds: number[]) {
    if (l2NodeIds.length === 0) return [];
    const rows = await db.select().from(l2NodesTable).where(eq(l2NodesTable.projectId, projectId));
    return rows.filter((r) => l2NodeIds.includes(r.id));
  }

  async updatePrAnalysisStatus(
    projectId: number,
    prNumber: number,
    status: "pending" | "in_progress" | "completed" | "failed",
    aiSummary?: string
  ) {
    await db
      .update(pullRequestsTable)
      .set({
        analysisStatus: status,
        updatedAt: new Date(),
        ...(aiSummary !== undefined && { aiSummary }),
      })
      .where(
        and(
          eq(pullRequestsTable.projectId, projectId),
          eq(pullRequestsTable.githubPrNumber, prNumber)
        )
      );
  }

  async getRecentNodesForAnalysis(projectId: number, prCreatedAt: Date) {
    const l3Nodes = await db
      .select({
        title: l3NodesTable.title,
        nodeType: l3NodesTable.nodeType,
        content: l3NodesTable.content,
      })
      .from(l3NodesTable)
      .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
      .where(and(eq(l2NodesTable.projectId, projectId), gte(l3NodesTable.createdAt, prCreatedAt)))
      .limit(50);

    const l2Nodes = await db
      .select({
        name: l2NodesTable.name,
        type: l2NodesTable.type,
        description: l2NodesTable.description,
      })
      .from(l2NodesTable)
      .where(and(eq(l2NodesTable.projectId, projectId), gte(l2NodesTable.createdAt, prCreatedAt)))
      .limit(30);

    return { l2Nodes, l3Nodes };
  }

  async runAnalysis(projectId: number, prNumber: number, prCreatedAt: Date) {
    try {
      await this.updatePrAnalysisStatus(projectId, prNumber, "in_progress");

      const { l2Nodes, l3Nodes } = await this.getRecentNodesForAnalysis(projectId, prCreatedAt);

      let aiSummary = "No knowledge graph changes were detected for this PR.";

      if (l3Nodes.length || l2Nodes.length) {
        const context = JSON.stringify({ l2Nodes, l3Nodes }, null, 2);
        const { orchestrator, model } = await getLlmOrchestratorForProject(projectId);
        const response = await orchestrator.generate({
          model,
          max_tokens: 1024,
          messages: [
            {
              role: "system",
              content:
                "You are a technical documentation assistant. Given a list of knowledge graph changes from a PR, write a concise Markdown impact summary with sections: ## Modules Affected, ## Key Decisions, ## Summary.",
            },
            {
              role: "user",
              content: `Knowledge graph changes:\n${context}`,
            },
          ],
        });
        aiSummary = response.content ?? aiSummary;
      }

      await this.updatePrAnalysisStatus(projectId, prNumber, "completed", aiSummary);
    } catch (err) {
      await this.updatePrAnalysisStatus(projectId, prNumber, "failed").catch(() => {});
      throw err;
    }
  }
}
