import {
  DI_TOKENS,
  IDashboardService,
  IDocumentService,
  IGitIngestionService,
  container,
} from "@workspace/core";
import { DashboardService, DocumentService, GitIngestionService } from "@workspace/plugins-domain";

export { container };

export function setupDI() {
  container.register<IDashboardService>(DI_TOKENS.DashboardService, new DashboardService());
  container.register<IDocumentService>(DI_TOKENS.DocumentService, new DocumentService());
  container.register<IGitIngestionService>(
    DI_TOKENS.GitIngestionService,
    new GitIngestionService()
  );
}

// Initialize immediately so routes can resolve at module level
setupDI();
