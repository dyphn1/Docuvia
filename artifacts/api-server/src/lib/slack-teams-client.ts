import { logger } from "./logger.js";
import type { ProjectIntegration } from "@workspace/db";
import { db, projectIntegrationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
}

function buildSlackPayload(
  eventType: string,
  payload: Record<string, unknown>,
  projectName: string
): { text: string; blocks: SlackBlock[] } {
  const emojiMap: Record<string, string> = {
    new_commit: ":git:",
    new_l3_node: ":bulb:",
    cross_link_detected: ":link:",
  };
  const titleMap: Record<string, string> = {
    new_commit: "New commits ingested",
    new_l3_node: "New L3 decision nodes generated",
    cross_link_detected: "Cross-project link detected",
  };

  const emoji = emojiMap[eventType] ?? ":bell:";
  const title = titleMap[eventType] ?? eventType;
  const summary = `${emoji} *Docuvia* — ${title} in project *${projectName}*`;

  const fields: SlackBlock[] = [];
  if (typeof payload.l3Count === "number") {
    fields.push({
      type: "section",
      text: { type: "mrkdwn", text: `*L3 Nodes:* ${payload.l3Count}` },
    });
  }
  if (typeof payload.commitCount === "number") {
    fields.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Commits:* ${payload.commitCount}` },
    });
  }
  if (typeof payload.similarity === "number") {
    fields.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Similarity:* ${Math.round((payload.similarity as number) * 100)}%`,
      },
    });
  }

  return {
    text: summary,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: summary } }, ...fields],
  };
}

async function postSlackMessage(
  webhookUrl: string,
  eventType: string,
  payload: Record<string, unknown>,
  projectName: string
): Promise<boolean> {
  const body = buildSlackPayload(eventType, payload, projectName);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, webhookUrl }, "Slack webhook returned non-OK status");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, webhookUrl }, "Failed to post to Slack webhook");
    return false;
  }
}

function buildTeamsPayload(
  eventType: string,
  payload: Record<string, unknown>,
  projectName: string
): Record<string, unknown> {
  const colorMap: Record<string, string> = {
    new_commit: "0078D7",
    new_l3_node: "107C10",
    cross_link_detected: "D83B01",
  };
  const titleMap: Record<string, string> = {
    new_commit: "New Commits Ingested",
    new_l3_node: "New L3 Decision Nodes Generated",
    cross_link_detected: "Cross-Project Link Detected",
  };

  const facts: Array<{ name: string; value: string }> = [];
  if (typeof payload.l3Count === "number")
    facts.push({ name: "L3 Nodes", value: String(payload.l3Count) });
  if (typeof payload.commitCount === "number")
    facts.push({ name: "Commits", value: String(payload.commitCount) });
  if (typeof payload.similarity === "number")
    facts.push({
      name: "Similarity",
      value: `${Math.round((payload.similarity as number) * 100)}%`,
    });

  return {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor: colorMap[eventType] ?? "6264A7",
    summary: `Docuvia: ${titleMap[eventType] ?? eventType}`,
    sections: [
      {
        activityTitle: `Docuvia — ${titleMap[eventType] ?? eventType}`,
        activitySubtitle: `Project: **${projectName}**`,
        facts,
        markdown: true,
      },
    ],
  };
}

async function postTeamsMessage(
  webhookUrl: string,
  eventType: string,
  payload: Record<string, unknown>,
  projectName: string
): Promise<boolean> {
  const body = buildTeamsPayload(eventType, payload, projectName);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, webhookUrl }, "Teams webhook returned non-OK status");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, webhookUrl }, "Failed to post to Teams webhook");
    return false;
  }
}

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

      if (integration.integrationType === "slack") {
        await postSlackMessage(integration.webhookUrl, eventType, payload, projectName);
      } else if (integration.integrationType === "teams") {
        await postTeamsMessage(integration.webhookUrl, eventType, payload, projectName);
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
  const testPayload: Record<string, unknown> = { l3Count: 3, commitCount: 5 };
  if (integration.integrationType === "slack") {
    return postSlackMessage(integration.webhookUrl, "new_l3_node", testPayload, projectName);
  }
  return postTeamsMessage(integration.webhookUrl, "new_l3_node", testPayload, projectName);
}
