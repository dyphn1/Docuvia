import { logger } from "../utils/logger.js";
import { assertPublicHttpUrl } from "../utils/ssrf-guard.js";

export interface INotificationProvider {
  notify(
    webhookUrl: string,
    eventType: string,
    payload: Record<string, unknown>,
    projectName: string
  ): Promise<boolean>;
  sendTestNotification?(webhookUrl: string, projectName: string): Promise<boolean>;
}

/**
 * Shared webhook-posting behavior for chat-notification providers (Slack, Teams, ...).
 * Subclasses only need to supply their channel-specific payload shape via buildPayload().
 */
export abstract class BaseWebhookNotificationProvider implements INotificationProvider {
  protected abstract readonly providerLabel: string;
  protected abstract buildPayload(
    eventType: string,
    payload: Record<string, unknown>,
    projectName: string
  ): Record<string, unknown>;

  async notify(
    webhookUrl: string,
    eventType: string,
    payload: Record<string, unknown>,
    projectName: string
  ): Promise<boolean> {
    const body = this.buildPayload(eventType, payload, projectName);
    try {
      const safeWebhookUrl = await assertPublicHttpUrl(
        webhookUrl,
        `${this.providerLabel} webhook URL`
      );
      const res = await fetch(safeWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        logger.warn(
          { status: res.status, webhookUrl },
          `${this.providerLabel} webhook returned non-OK status`
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.warn({ err, webhookUrl }, `Failed to post to ${this.providerLabel} webhook`);
      return false;
    }
  }

  async sendTestNotification(webhookUrl: string, projectName: string): Promise<boolean> {
    const testPayload: Record<string, unknown> = { l3Count: 3, commitCount: 5 };
    return this.notify(webhookUrl, "new_l3_node", testPayload, projectName);
  }
}
