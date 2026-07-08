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
  container.register(DI_TOKENS.InitService, InitService);
  container.register(DI_TOKENS.AnalyzeService, AnalyzeService);
  container.register(DI_TOKENS.ExtractService, ExtractService);
  container.register(DI_TOKENS.ChangeDetectionService, ChangeDetectionService);
  container.register(DI_TOKENS.QueryService, QueryService);
  container.register(DI_TOKENS.SyncService, SyncService);
  container.register(DI_TOKENS.StatusService, StatusService);
  container.register(DI_TOKENS.CleanService, CleanService);
  container.register(DI_TOKENS.TopologyExportService, TopologyExportService);
  container.register(DI_TOKENS.LocalOrphanBranchWriter, LocalOrphanBranchWriter);
}
