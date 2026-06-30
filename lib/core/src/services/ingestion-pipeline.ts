import { db } from "@workspace/db";
import {
  commitsTable,
  documentsTable,
  projectsTable,
  activityLogTable,
  subscriptionsTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { notifyExternalIntegrations } from "./slack-teams-client.js";
import { scoreCommit } from "./commit-scorer.js";
import crypto from "crypto";
import { logger } from "./logger.js";

type IngestType = "git" | "svn" | "document";

interface BaseIngestData {
  projectId: number;
  projectName: string;
}

export interface GitCommitItem {
  sha: string;
  message: string;
  author: string;
  date?: string;
  diff?: string;
}

export interface SvnCommitItem {
  revision: number;
  message: string;
  author: string;
  diff?: string;
}

export interface DocumentItem {
  filename: string;
  content: string;
  docType: "markdown" | "txt" | "pdf" | "docx" | "pptx" | "build_artifact";
  commitSha?: string;
  contentHash?: string;
}

export interface ProcessIngestionParams {
  type: IngestType;
  projectId: number;
  projectName: string;
  items: (GitCommitItem | SvnCommitItem | DocumentItem)[];
}

export async function processIngestion(
  { type, projectId, projectName, items }: ProcessIngestionParams,
  txParams: any = db
): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  let ingested = 0;
  let skipped = 0;
  const errors: string[] = [];

  if (type === "git") {
    const gitItems = items as GitCommitItem[];
    // To prevent unbounded memory/CPU spikes, strictly process max 50 at a time.
    const batchSize = 50;

    // We already fetch hashes, but we should do it per batch to handle duplicates cleanly without memory bloat
    for (let i = 0; i < gitItems.length; i += batchSize) {
      const batch = gitItems.slice(i, i + batchSize);

      await txParams.transaction(async (tx: any) => {
        const batchHashes = batch.map((c) => c.sha);
        const existingRecords = await tx
          .select({ hash: commitsTable.hash })
          .from(commitsTable)
          .where(eq(commitsTable.projectId, projectId)); // Simplified for standard Drizzle

        const existingHashes = new Set(
          existingRecords.filter((r: any) => batchHashes.includes(r.hash)).map((r: any) => r.hash)
        );

        let batchIngested = 0;
        let lastHash = "";

        for (const c of batch) {
          if (existingHashes.has(c.sha)) {
            skipped++;
            continue;
          }
          const { valid } = scoreCommit(c.message, c.diff);
          if (!valid) {
            skipped++;
            continue;
          }
          await tx.insert(commitsTable).values({
            projectId,
            hash: c.sha,
            message: c.message.slice(0, 4000),
            author: c.author ?? "Unknown",
            valid,
            vcsType: "git",
          });
          batchIngested++;
          lastHash = c.sha;
        }

        if (batchIngested > 0) {
          // Update cursor column
          await tx
            .update(projectsTable)
            .set({ lastGitIngestedAt: new Date() }) // Real implementation would use the commit date or sha
            .where(eq(projectsTable.id, projectId));

          ingested += batchIngested;
        }
      });
    }

    if (ingested > 0) {
      await logAndNotify(
        txParams,
        projectId,
        projectName,
        "commit",
        `Ingested ${ingested} git commits`,
        ingested
      );
    }
  } else if (type === "svn") {
    const svnItems = items as SvnCommitItem[];
    for (const c of svnItems) {
      const [existing] = await db
        .select({ id: commitsTable.id })
        .from(commitsTable)
        .where(
          and(
            eq(commitsTable.projectId, projectId),
            eq(commitsTable.vcsType, "svn"),
            eq(commitsTable.revision, c.revision)
          )
        );

      if (existing) {
        skipped++;
        continue;
      }

      const { valid } = scoreCommit(c.message, c.diff);
      if (!valid) {
        skipped++;
        continue;
      }
      const fullMessage = c.diff ? `${c.message}\n\n${c.diff}` : c.message;

      await txParams.insert(commitsTable).values({
        projectId,
        hash: `svn:R${c.revision}`,
        message: fullMessage.slice(0, 4000),
        author: c.author,
        valid,
        revision: c.revision,
        vcsType: "svn",
      });
      ingested++;
    }

    if (ingested > 0) {
      await logAndNotify(
        txParams,
        projectId,
        projectName,
        "commit",
        `Ingested ${ingested} SVN revisions`,
        ingested
      );
    }
  } else if (type === "document") {
    const docItems = items as DocumentItem[];
    for (const doc of docItems) {
      const hash = doc.contentHash ?? crypto.createHash("sha256").update(doc.content).digest("hex");

      const [existing] = await db
        .select({ id: documentsTable.id })
        .from(documentsTable)
        .where(and(eq(documentsTable.projectId, projectId), eq(documentsTable.contentHash, hash)));

      if (existing) {
        skipped++;
        continue;
      }

      try {
        await txParams.insert(documentsTable).values({
          projectId,
          filename: doc.filename,
          docType: doc.docType as any,
          content: doc.content,
          contentHash: hash,
        });
        ingested++;
      } catch (e: any) {
        errors.push(`Doc ${doc.filename}: ${e.message}`);
      }
    }

    if (ingested > 0) {
      await logAndNotify(
        txParams,
        projectId,
        projectName,
        "document",
        `Ingested ${ingested} documents`,
        ingested
      );
    }
  }

  return { ingested, skipped, errors };
}

async function logAndNotify(
  txParams: any,
  projectId: number,
  projectName: string,
  activityType: "commit" | "tag_added" | "document",
  description: string,
  count: number
) {
  await txParams.insert(activityLogTable).values({
    type: activityType,
    description,
    projectId,
  });

  await db
    .update(projectsTable)
    .set({ updatedAt: new Date() })
    .where(eq(projectsTable.id, projectId));

  const subscribers = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.publisherProjectId, projectId));

  for (const sub of subscribers) {
    await txParams.insert(notificationsTable).values({
      projectId: sub.subscriberProjectId,
      type: activityType === "commit" ? "new_commit" : "new_document",
      payload: {
        [activityType === "commit" ? "commitCount" : "documentCount"]: count,
        projectId,
        projectName,
      },
      read: false,
    });
  }

  void notifyExternalIntegrations(
    projectId,
    projectName,
    activityType === "commit" ? "new_commit" : "new_document",
    {
      [activityType === "commit" ? "commitCount" : "documentCount"]: count,
      projectId,
    }
  );
}
