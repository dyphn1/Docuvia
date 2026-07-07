import { logger } from "../utils/logger.js";
import { assertPublicHttpUrl } from "../utils/ssrf-guard.js";
import type { INotificationProvider } from "./notification.provider.js";

export class TeamsProvider implements INotificationProvider {
  private buildPayload(
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

  async notify(
    webhookUrl: string,
    eventType: string,
    payload: Record<string, unknown>,
    projectName: string
  ): Promise<boolean> {
    const body = this.buildPayload(eventType, payload, projectName);
    try {
      const safeWebhookUrl = await assertPublicHttpUrl(webhookUrl, "Teams webhook URL");
      const res = await fetch(safeWebhookUrl, {
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

  async sendTestNotification(webhookUrl: string, projectName: string): Promise<boolean> {
    const testPayload: Record<string, unknown> = { l3Count: 3, commitCount: 5 };
    return this.notify(webhookUrl, "new_l3_node", testPayload, projectName);
  }
}
