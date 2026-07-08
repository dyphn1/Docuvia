import {
  DI_TOKENS,
  container,
  InitService,
  AnalyzeService,
  QueryService,
  SyncService,
  StatusService,
  CleanService,
  TopologyExportService,
  LocalOrphanBranchWriter,
  ExtractService,
  ChangeDetectionService,
} from "@workspace/core";

export function setupDI() {
  // Register CLI specific services
  container.register(DI_TOKENS.InitService, new InitService());
  container.register(DI_TOKENS.AnalyzeService, new AnalyzeService());
  container.register(DI_TOKENS.ExtractService, new ExtractService());
  container.register(DI_TOKENS.ChangeDetectionService, new ChangeDetectionService());
  container.register(DI_TOKENS.QueryService, new QueryService());
  container.register(DI_TOKENS.SyncService, new SyncService());
  container.register(DI_TOKENS.StatusService, new StatusService());
  container.register(DI_TOKENS.CleanService, new CleanService());
  container.register(DI_TOKENS.TopologyExportService, new TopologyExportService());
  container.register(DI_TOKENS.LocalOrphanBranchWriter, new LocalOrphanBranchWriter());
}
