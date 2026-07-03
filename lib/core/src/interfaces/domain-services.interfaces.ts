export interface IDashboardService {
  getDashboardStats(): Promise<any>;
}

export interface IDocumentService {
  listDocumentsByProjectId(projectId: number): Promise<any>;
  listMiscDocuments(): Promise<any>;
  affiliateDocument(id: number, projectId: number): Promise<any>;
  processAndSaveDocument(file: any, uploadedBy: number): Promise<any>;
}

export interface IGitIngestionService {
  ingestGit(project: any, options: any): Promise<any>;
}

export interface IProjectService {
  listProjects(): Promise<any>;
  createProject(body: any): Promise<any>;
  getProject(id: number): Promise<any>;
  updateProject(id: number, body: any): Promise<any>;
  deleteProject(id: number): Promise<any>;
  getProjectGraph(id: number): Promise<any>;
  listProjectCommits(id: number): Promise<any>;
  createProjectCommit(id: number, body: any): Promise<any>;
  listProjectL2Nodes(id: number): Promise<any>;
  syncProject(id: number): Promise<any>;
  getProjectById(projectId: number): Promise<any>;
}

export interface IProjectStatusService {
  getStatus(projectId: number, since?: Date): Promise<any>;
}

export interface IPullRequestService {
  getPullRequestsByProjectId(projectId: number): Promise<any>;
  getPullRequest(projectId: number, prNumber: number): Promise<any>;
  getCommitsAfterPr(projectId: number, prCreatedAt: Date): Promise<any>;
  getL3NodesByProjectId(projectId: number): Promise<any>;
  getL2NodesByIds(projectId: number, l2NodeIds: number[]): Promise<any>;
  updatePrAnalysisStatus(
    projectId: number,
    prNumber: number,
    status: string,
    summary?: string
  ): Promise<any>;
  getRecentNodesForAnalysis(projectId: number, prCreatedAt: Date): Promise<any>;
  runAnalysis(projectId: number, prNumber: number, prCreatedAt: Date): Promise<any>;
}

export interface INotificationService {
  getNotificationsByProjectId(projectId: number, unreadOnly: boolean): Promise<any>;
  markAsRead(notificationId: number): Promise<any>;
  markAllAsRead(projectId: number): Promise<any>;
}

export interface ISvnIngestionService {
  ingestSvn(project: any, options: any): Promise<any>;
}

export interface IDocumentIngestionService {
  ingestDocumentFromFile(projectId: number, filePath: string, originalName: string): Promise<any>;
  ingestDocumentFromContent(projectId: number, content: string, filename: string): Promise<any>;
  ingestBuildArtifactFromFile(
    projectId: number,
    filePath: string,
    originalName: string,
    docType: string
  ): Promise<any>;
}

export interface IExportService {
  exportProjectToJson(projectId: number): Promise<any>;
  exportProjectToMarkdownStream(projectId: number, stream: any): Promise<any>;
}

export interface IGithubWebhookService {
  processWebhook(event: string, payload: any): Promise<any>;
}

export interface IIntegrationService {
  getIntegrationsByProjectId(projectId: number): Promise<any>;
  createIntegration(projectId: number, body: any): Promise<any>;
  updateIntegration(integrationId: number, body: any): Promise<any>;
  deleteIntegration(integrationId: number): Promise<any>;
  getIntegrationById(integrationId: number): Promise<any>;
  getProjectByIntegrationId(integrationId: number): Promise<any>;
}

export interface IL1TagsService {
  getAllTags(): Promise<any>;
  createTag(body: any): Promise<any>;
  updateTag(id: number, body: any): Promise<any>;
  deleteTag(id: number): Promise<any>;
}

export interface IL2NodesService {
  confirmBootstrap(projectId: number, body: any): Promise<any>;
  createNode(body: any): Promise<any>;
  updateNode(id: number, body: any): Promise<any>;
  deleteNode(id: number): Promise<any>;
  getLinks(id: number): Promise<any>;
  createLink(sourceNodeId: number, targetNodeId: number, linkType?: string): Promise<any>;
}

export interface IL3NodesService {
  getNodesByL2Id(l2NodeId: number): Promise<any>;
  createNode(l2NodeId: number, body: any): Promise<any>;
  updateNode(id: number, body: any): Promise<any>;
  deleteNode(id: number): Promise<any>;
}

export interface ILlmConfigService {
  getConfigByProjectId(projectId: number): Promise<any>;
  createConfig(projectId: number, provider: string, model: string): Promise<any>;
  updateConfig(id: number, data: any): Promise<any>;
  getOrCreateConfig(
    projectId: number,
    defaultProvider?: string,
    defaultModel?: string
  ): Promise<any>;
}

export interface IMetabolismService {
  withMetabolismLock<T>(fn: () => Promise<T>): Promise<T | null>;
  runAll(): Promise<void>;
  processPendingL3Nodes(): Promise<void>;
  distillPendingCorrections(): Promise<void>;
}

export interface IReviewTasksService {
  getAllTasks(): Promise<any>;
  getTaskStats(): Promise<any>;
  resolveTask(id: number, userId: number, body: any): Promise<any>;
}

export interface ISearchService {
  processFeedback(queryId: string, isPositive: boolean): Promise<any>;
}

export interface ISubscriptionService {
  getProject(projectId: number): Promise<any>;
  createSubscription(subscriberProjectId: number, publisherProjectId: number): Promise<any>;
  deleteSubscription(subscriptionId: number): Promise<any>;
  getSubscriptionsForProject(projectId: number): Promise<any>;
}

export interface ITemplateService {
  getTemplatesByProjectId(projectId: number): Promise<any>;
  getTemplate(projectId: number, templateType: string): Promise<any>;
  updateTemplate(id: number, systemPrompt: string): Promise<any>;
  createTemplate(projectId: number, templateType: string, systemPrompt: string): Promise<any>;
  deleteTemplate(projectId: number, templateType: string): Promise<any>;
}
