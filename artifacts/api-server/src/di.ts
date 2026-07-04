import {
  DI_TOKENS,
  IDashboardService,
  IDocumentService,
  IGitIngestionService,
} from "@workspace/core";
import { DashboardService, DocumentService, GitIngestionService } from "@workspace/plugins-domain";

class Container {
  private services = new Map<symbol, any>();

  register<T>(token: symbol, service: T) {
    this.services.set(token, service);
  }

  resolve<T>(token: symbol): T {
    const service = this.services.get(token);
    if (!service) {
      throw new Error(`Service not found for token: ${String(token)}`);
    }
    return service;
  }
}

export const container = new Container();

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
