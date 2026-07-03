export const DI_TOKENS = {
  DashboardService: Symbol.for("DashboardService"),
  DocumentService: Symbol.for("DocumentService"),
  GitIngestionService: Symbol.for("GitIngestionService"),
  ProjectService: Symbol.for("ProjectService"),
  ProjectStatusService: Symbol.for("ProjectStatusService"),
  PullRequestService: Symbol.for("PullRequestService"),
  NotificationService: Symbol.for("NotificationService"),
  SvnIngestionService: Symbol.for("SvnIngestionService"),
  DocumentIngestionService: Symbol.for("DocumentIngestionService"),
  ExportService: Symbol.for("ExportService"),
  GithubWebhookService: Symbol.for("GithubWebhookService"),
  IntegrationService: Symbol.for("IntegrationService"),
  L1TagsService: Symbol.for("L1TagsService"),
  L2NodesService: Symbol.for("L2NodesService"),
  L3NodesService: Symbol.for("L3NodesService"),
  LlmConfigService: Symbol.for("LlmConfigService"),
  MetabolismService: Symbol.for("MetabolismService"),
  ReviewTasksService: Symbol.for("ReviewTasksService"),
  SearchService: Symbol.for("SearchService"),
  SubscriptionService: Symbol.for("SubscriptionService"),
  TemplateService: Symbol.for("TemplateService"),
  EventBus: Symbol.for("EventBus"),
};

export interface IEventBus {
  emit(event: string, payload: any): void;
  on(event: string, handler: (payload: any) => void): void;
}
