import { logger } from "../utils/logger.js";
import type { ProjectIntegration } from "@workspace/db";
import { db, projectIntegrationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { INotificationProvider } from "./notification.provider.js";
import { SlackProvider } from "./slack.provider.js";
import { TeamsProvider } from "./teams.provider.js";

const PROVIDERS: Record<string, INotificationProvider> = {
  slack: new SlackProvider(),
  teams: new TeamsProvider(),
};

export async function notifyExternalIntegrations(
  projectId: number,
  projectName: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const integrations = await db
      .select()
      .from(projectIntegrationsTable)
      .where(
        and(
          eq(projectIntegrationsTable.projectId, projectId),
          eq(projectIntegrationsTable.enabled, true)
        )
      );

    for (const integration of integrations) {
      const allowedTypes = integration.notificationTypes as string[] | null;
      if (allowedTypes && !allowedTypes.includes(eventType)) continue;

      const provider = PROVIDERS[integration.integrationType];
      if (provider) {
        await provider.notify(integration.webhookUrl, eventType, payload, projectName);
      }
    }
  } catch (err) {
    logger.warn({ err, projectId, eventType }, "notifyExternalIntegrations failed");
  }
}

export async function sendTestNotification(
  integration: ProjectIntegration,
  projectName: string
): Promise<boolean> {
  const provider = PROVIDERS[integration.integrationType];
  if (!provider?.sendTestNotification) return false;
  return provider.sendTestNotification(integration.webhookUrl, projectName);
}
