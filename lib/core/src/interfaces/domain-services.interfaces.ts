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
