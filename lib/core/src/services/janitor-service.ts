import { db } from "@workspace/db";
import { l3NodesTable, commitsTable, commitL3LinksTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "../utils/logger.js";

export class JanitorService {
  async reanchorL3Rules(): Promise<void> {
    logger.info("Starting L3 rule reanchoring janitor job...");

    const pendingNodes = await db
      .select()
      .from(l3NodesTable)
      .where(eq(l3NodesTable.validityStatus, "pending"));

    let healedCount = 0;
    let gcCount = 0;

    for (const node of pendingNodes) {
      let validCommits = false;
      const commitsToCheck =
        node.sourceCommits && node.sourceCommits.length > 0
          ? node.sourceCommits
          : node.commitHash
            ? [node.commitHash]
            : [];

      if (commitsToCheck.length > 0) {
        const matchingCommits = await db
          .select({ id: commitsTable.id, hash: commitsTable.hash })
          .from(commitsTable)
          .where(inArray(commitsTable.hash, commitsToCheck));

        if (matchingCommits.length > 0) {
          validCommits = true;

          await db
            .update(l3NodesTable)
            .set({
              sourceCommits: matchingCommits.map((c) => c.hash),
              validityStatus: "valid",
            })
            .where(eq(l3NodesTable.id, node.id));

          for (const commit of matchingCommits) {
            const exists = await db
              .select()
              .from(commitL3LinksTable)
              .where(
                and(
                  eq(commitL3LinksTable.commitId, commit.id),
                  eq(commitL3LinksTable.l3NodeId, node.id)
                )
              );
            if (exists.length === 0) {
              await db.insert(commitL3LinksTable).values({
                commitId: commit.id,
                l3NodeId: node.id,
              });
            }
          }
        }
      }

      if (!validCommits) {
        if (node.contentHash) {
          const siblingNodes = await db
            .select()
            .from(l3NodesTable)
            .where(
              and(
                eq(l3NodesTable.contentHash, node.contentHash),
                eq(l3NodesTable.validityStatus, "valid")
              )
            );

          if (siblingNodes.length > 0) {
            const validSibling = siblingNodes.find(
              (n) => n.sourceCommits && n.sourceCommits.length > 0
            );
            if (validSibling) {
              await db.transaction(async (tx) => {
                await tx
                  .update(l3NodesTable)
                  .set({
                    sourceCommits: validSibling.sourceCommits,
                    commitHash: validSibling.commitHash,
                    validityStatus: "valid",
                  })
                  .where(eq(l3NodesTable.id, node.id));

                const commits = await tx
                  .select()
                  .from(commitsTable)
                  .where(inArray(commitsTable.hash, validSibling.sourceCommits));

                for (const c of commits) {
                  await tx
                    .insert(commitL3LinksTable)
                    .values({
                      commitId: c.id,
                      l3NodeId: node.id,
                    })
                    .catch(() => {});
                }
              });
              healedCount++;
              continue;
            }
          }
        }

        await db
          .update(l3NodesTable)
          .set({ validityStatus: "garbage" })
          .where(eq(l3NodesTable.id, node.id));
        gcCount++;
      }
    }

    logger.info({ healedCount, gcCount }, "L3 rule reanchoring janitor job completed");
  }
}
