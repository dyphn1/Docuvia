import { logger } from "../utils/logger.js";
import type { ProjectIntegration } from "@workspace/db";
import { db, projectIntegrationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { SlackProvider } from "./slack.provider.js";
import { TeamsProvider } from "./teams.provider.js";

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

    const slackProvider = new SlackProvider();
    const teamsProvider = new TeamsProvider();

    for (const integration of integrations) {
      const allowedTypes = integration.notificationTypes as string[] | null;
      if (allowedTypes && !allowedTypes.includes(eventType)) continue;

      if (integration.integrationType === "slack") {
        await slackProvider.notify(integration.webhookUrl, eventType, payload, projectName);
      } else if (integration.integrationType === "teams") {
        await teamsProvider.notify(integration.webhookUrl, eventType, payload, projectName);
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
  if (integration.integrationType === "slack") {
    const provider = new SlackProvider();
    return provider.sendTestNotification(integration.webhookUrl, projectName);
  } else if (integration.integrationType === "teams") {
    const provider = new TeamsProvider();
    return provider.sendTestNotification(integration.webhookUrl, projectName);
  }
  return false;
}
