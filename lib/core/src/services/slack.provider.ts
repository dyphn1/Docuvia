import { logger } from "../utils/logger.js";
import { assertPublicHttpUrl } from "../utils/ssrf-guard.js";
import type { INotificationProvider } from "./notification.provider.js";

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
}

export class SlackProvider implements INotificationProvider {
  private buildPayload(
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

  async notify(
    webhookUrl: string,
    eventType: string,
    payload: Record<string, unknown>,
    projectName: string
  ): Promise<boolean> {
    const body = this.buildPayload(eventType, payload, projectName);
    try {
      const safeWebhookUrl = await assertPublicHttpUrl(webhookUrl, "Slack webhook URL");
      const res = await fetch(safeWebhookUrl, {
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

  async sendTestNotification(webhookUrl: string, projectName: string): Promise<boolean> {
    const testPayload: Record<string, unknown> = { l3Count: 3, commitCount: 5 };
    return this.notify(webhookUrl, "new_l3_node", testPayload, projectName);
  }
}
