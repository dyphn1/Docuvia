import { db } from "@workspace/db";
import { subscriptionsTable, projectsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";

export class SubscriptionService {
  async getProject(projectId: number) {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    return project;
  }

  async createSubscription(subscriberProjectId: number, publisherProjectId: number) {
    const [sub] = await db
      .insert(subscriptionsTable)
      .values({
        subscriberProjectId,
        publisherProjectId,
      })
      .returning();
    return sub;
  }

  async deleteSubscription(subscriptionId: number) {
    const [deleted] = await db
      .delete(subscriptionsTable)
      .where(eq(subscriptionsTable.id, subscriptionId))
      .returning();
    return deleted;
  }

  async getSubscriptionsForProject(projectId: number) {
    return await db
      .select()
      .from(subscriptionsTable)
      .where(
        or(
          eq(subscriptionsTable.subscriberProjectId, projectId),
          eq(subscriptionsTable.publisherProjectId, projectId)
        )
      );
  }
}
