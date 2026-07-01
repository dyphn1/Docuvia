import crypto from "crypto";
import { db } from "@workspace/db";
import {
  projectsTable,
  commitsTable,
  pullRequestsTable,
  l2NodesTable,
  l3NodesTable,
  notificationsTable,
  subscriptionsTable,
} from "@workspace/db";
import { eq, and, inArray, gte } from "drizzle-orm";
import { getLlmClientForProject, fetchPrCommits, parseGithubRepo, postPrComment, logger, scoreCommit } from "@workspace/core";

export class GithubWebhookService {
  /**
   * Validates the HMAC signature of the GitHub webhook payload.
   */
  public verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
    const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    // Pad to same length to avoid timing attacks if lengths differ
    const sigBuf = Buffer.from(signature.padEnd(expected.length, "\0"));
    const expBuf = Buffer.from(expected.padEnd(sigBuf.length, "\0"));
    return crypto.timingSafeEqual(expBuf, sigBuf);
  }

  /**
   * Main entry orchestrator for GitHub webhooks
   */
  public async processWebhook(
    projectId: number,
    rawBody: Buffer,
    signature: string,
    eventType: string,
    webhookSecret: string
  ): Promise<{ status: number; message?: string; error?: string }> {
    if (!signature) {
      logger.warn({ projectId }, "GitHub webhook: missing X-Hub-Signature-256 header");
      return { status: 401, error: "Missing signature header" };
    }

    if (!this.verifySignature(rawBody, signature, webhookSecret)) {
      logger.warn({ projectId }, "GitHub webhook: invalid HMAC signature");
      return { status: 401, error: "Invalid signature" };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      return { status: 400, error: "Invalid JSON payload" };
    }

    // Only handle pull_request events for now
    if (eventType === "pull_request") {
      const prResult = await this.handlePullRequestEvent(projectId, payload);
      if (prResult.error) {
        return { status: prResult.status, error: prResult.error };
      }
      return { status: 202, message: "Accepted" };
    } else if (eventType === "push") {
      this.handlePushEvent(projectId, payload);
      return { status: 202, message: "Accepted" };
    }

    return { status: 200, message: "Event ignored" };
  }

  public handlePushEvent(projectId: number, payload: Record<string, unknown>): void {
    // Logic for matching docuvia.yaml, extracting .md files, and dispatching RAG updates.
    logger.info({ projectId }, "Push event received but not fully implemented yet");
  }

  public async handlePullRequestEvent(
    projectId: number,
    payload: Record<string, unknown>
  ): Promise<{ status: number; error?: string }> {
    const pr = payload["pull_request"] as Record<string, unknown> | undefined;
    if (!pr) {
      return { status: 400, error: "Missing pull_request payload" };
    }

    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) {
      return { status: 404, error: "Project not found" };
    }

    const repoData = payload["repository"] as Record<string, unknown> | undefined;
    const repoFullName = (repoData?.["full_name"] as string) ?? "";
    const parsed = parseGithubRepo(`github.com/${repoFullName}`);
    if (!parsed) {
      return { status: 400, error: "Cannot parse repository from payload" };
    }

    const { owner, repo } = parsed;
    const token = process.env.GITHUB_TOKEN;
    const action = payload["action"] as string | undefined;
    const isMerged = payload["merged"] === true;

    const prNumber = pr["number"] as number;
    const prTitle = (pr["title"] as string) ?? "";
    const prBody = (pr["body"] as string | null) ?? null;
    const headSha = ((pr["head"] as Record<string, unknown>)?.["sha"] as string) ?? "";
    const baseSha = ((pr["base"] as Record<string, unknown>)?.["sha"] as string) ?? "";
    const author = ((pr["user"] as Record<string, unknown>)?.["login"] as string) ?? "unknown";
    const prUrl = (pr["html_url"] as string) ?? "";
    const mergedAtRaw = pr["merged_at"] as string | null;

    // Process asynchronously
    setImmediate(async () => {
      try {
        if (action === "opened" || action === "synchronize") {
          await this.processOpenedOrSynchronizedPr(
            projectId, prNumber, prTitle, prBody, headSha, baseSha, author, prUrl, owner, repo, token
          );
        } else if (action === "closed" && isMerged) {
          await this.processMergedPr(
            projectId, prNumber, prTitle, prUrl, mergedAtRaw, owner, repo, token
          );
        } else if (action === "closed") {
          // Closed but not merged
          await db
            .update(pullRequestsTable)
            .set({ state: "closed", updatedAt: new Date() })
            .where(
              and(
                eq(pullRequestsTable.projectId, projectId),
                eq(pullRequestsTable.githubPrNumber, prNumber)
              )
            );
        }
      } catch (err) {
        logger.error({ err, projectId, prNumber, action }, "GitHub webhook processing error");
        // Mark PR analysis as failed if it was in_progress
        await db
          .update(pullRequestsTable)
          .set({ analysisStatus: "failed", updatedAt: new Date() })
          .where(
            and(
              eq(pullRequestsTable.projectId, projectId),
              eq(pullRequestsTable.githubPrNumber, prNumber),
              eq(pullRequestsTable.analysisStatus, "in_progress")
            )
          )
          .catch((err) => logger.warn({ err }, "Ignored error"));
      }
    });

    return { status: 202 };
  }

  private async processOpenedOrSynchronizedPr(
    projectId: number, prNumber: number, prTitle: string, prBody: string | null,
    headSha: string, baseSha: string, author: string, prUrl: string,
    owner: string, repo: string, token?: string
  ) {
    const existingPr = await db
      .select()
      .from(pullRequestsTable)
      .where(
        and(
          eq(pullRequestsTable.projectId, projectId),
          eq(pullRequestsTable.githubPrNumber, prNumber)
        )
      );

    if (existingPr.length === 0) {
      await db.insert(pullRequestsTable).values({
        projectId,
        githubPrNumber: prNumber,
        title: prTitle,
        body: prBody,
        headSha,
        baseSha,
        author,
        state: "open",
        url: prUrl,
        analysisStatus: "pending",
      });
    } else {
      await db
        .update(pullRequestsTable)
        .set({ headSha, updatedAt: new Date() })
        .where(
          and(
            eq(pullRequestsTable.projectId, projectId),
            eq(pullRequestsTable.githubPrNumber, prNumber)
          )
        );
    }

    // Ingest PR commits
    await this.ingestPrCommits(projectId, owner, repo, prNumber, token);

    // Notify subscribers
    const subscribers = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.publisherProjectId, projectId));
    for (const sub of subscribers) {
      await db.insert(notificationsTable).values({
        projectId: sub.subscriberProjectId,
        type: "new_pr_opened",
        payload: { prNumber, title: prTitle, url: prUrl, projectId },
        read: false,
      });
    }

    logger.info({ projectId, prNumber }, "GitHub webhook: PR opened/synchronized processed");
  }

  private async processMergedPr(
    projectId: number, prNumber: number, prTitle: string, prUrl: string, mergedAtRaw: string | null,
    owner: string, repo: string, token?: string
  ) {
    await db
      .update(pullRequestsTable)
      .set({
        state: "merged",
        mergedAt: mergedAtRaw ? new Date(mergedAtRaw) : new Date(),
        analysisStatus: "in_progress",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pullRequestsTable.projectId, projectId),
          eq(pullRequestsTable.githubPrNumber, prNumber)
        )
      );

    try {
      const prCommits = await fetchPrCommits(owner, repo, prNumber, token);
      const prCommitHashes = prCommits.map((c) => c.sha);

      if (prCommitHashes.length > 0) {
        await db
          .update(l3NodesTable)
          .set({ validityStatus: "valid" })
          .where(
            and(
              inArray(l3NodesTable.commitHash, prCommitHashes),
              eq(l3NodesTable.validityStatus, "pending")
            )
          );

        logger.info({ projectId, prNumber }, "Updated L3 nodes validity status on PR merge");
      }
    } catch (err) {
      logger.warn(
        { err, projectId, prNumber },
        "Failed to update L3 nodes validity status on PR merge"
      );
    }

    const [prRecord] = await db
      .select()
      .from(pullRequestsTable)
      .where(
        and(
          eq(pullRequestsTable.projectId, projectId),
          eq(pullRequestsTable.githubPrNumber, prNumber)
        )
      );

    const prCreatedAt = prRecord?.createdAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const aiSummary = await this.generatePrAiSummary(projectId, prCreatedAt);

    await db
      .update(pullRequestsTable)
      .set({ aiSummary, analysisStatus: "completed", updatedAt: new Date() })
      .where(
        and(
          eq(pullRequestsTable.projectId, projectId),
          eq(pullRequestsTable.githubPrNumber, prNumber)
        )
      );

    if (token) {
      const commentBody = `## 🤖 Docuvia Knowledge Impact Summary\n\n${aiSummary}\n\n---\n*Generated by [Docuvia](https://github.com/docuvia)*`;
      await postPrComment(owner, repo, prNumber, commentBody, token);
    }

    const subscribers = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.publisherProjectId, projectId));
    for (const sub of subscribers) {
      await db.insert(notificationsTable).values({
        projectId: sub.subscriberProjectId,
        type: "pr_merged",
        payload: { prNumber, title: prTitle, url: prUrl, projectId },
        read: false,
      });
    }

    logger.info({ projectId, prNumber }, "GitHub webhook: PR merged, AI summary generated");
  }

  private async ingestPrCommits(
    projectId: number,
    owner: string,
    repo: string,
    prNumber: number,
    token?: string
  ): Promise<number> {
    const commits = await fetchPrCommits(owner, repo, prNumber, token);
    if (!commits.length) return 0;

    const existingHashes = new Set(
      (
        await db
          .select({ hash: commitsTable.hash })
          .from(commitsTable)
          .where(eq(commitsTable.projectId, projectId))
      ).map((r) => r.hash)
    );

    let ingested = 0;
    for (const c of commits) {
      if (existingHashes.has(c.sha)) continue;
      const { valid } = scoreCommit(c.commit.message);
      if (!valid) continue;
      await db.insert(commitsTable).values({
        projectId,
        hash: c.sha,
        message: c.commit.message.split("\n")[0].trim(),
        author: c.commit.author?.name ?? "Unknown",
        valid: true,
      });
      ingested++;
    }
    return ingested;
  }

  private async generatePrAiSummary(projectId: number, prCreatedAt: Date): Promise<string> {
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

    if (!l3Nodes.length && !l2Nodes.length) {
      return "No knowledge graph changes were detected for this PR.";
    }

    const context = JSON.stringify({ l2Nodes, l3Nodes }, null, 2);

    const { client, model } = await getLlmClientForProject(projectId);

    const response = await client.chat.completions.create({
      model,
      max_completion_tokens: 1024,
      messages: [
        {
          role: "system",
          content:
            "You are a technical documentation assistant. Given a list of knowledge graph changes from a PR, write a concise Markdown impact summary with sections: ## Modules Affected, ## Key Decisions, ## Summary. Be specific and brief.",
        },
        {
          role: "user",
          content: `Knowledge graph changes:\n${context}`,
        },
      ],
    });

    return response.choices[0]?.message?.content ?? "Unable to generate summary.";
  }
}
