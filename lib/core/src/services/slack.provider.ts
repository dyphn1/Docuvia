import { BaseWebhookNotificationProvider } from "./notification.provider.js";

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
}

export class SlackProvider extends BaseWebhookNotificationProvider {
  protected readonly providerLabel = "Slack";

  protected buildPayload(
    eventType: string,
    payload: Record<string, unknown>,
    projectName: string
  ): Record<string, unknown> {
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
}
