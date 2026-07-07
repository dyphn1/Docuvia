import type { ProjectIntegration } from "@workspace/db";

export interface INotificationProvider {
  notify(
    webhookUrl: string,
    eventType: string,
    payload: Record<string, unknown>,
    projectName: string
  ): Promise<boolean>;
  sendTestNotification?(webhookUrl: string, projectName: string): Promise<boolean>;
}
