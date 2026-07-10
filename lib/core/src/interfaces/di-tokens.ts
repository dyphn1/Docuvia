export const DI_TOKENS = {
  DashboardService: Symbol.for("DashboardService"),
  DocumentService: Symbol.for("DocumentService"),
  GitIngestionService: Symbol.for("GitIngestionService"),

  // CLI / Core Services
  InitService: Symbol.for("InitService"),
  AnalyzeService: Symbol.for("AnalyzeService"),
  ExtractService: Symbol.for("ExtractService"),
  QueryService: Symbol.for("QueryService"),
  SyncService: Symbol.for("SyncService"),
  StatusService: Symbol.for("StatusService"),
  ChangeDetectionService: Symbol.for("ChangeDetectionService"),
  CleanService: Symbol.for("CleanService"),
  TopologyExportService: Symbol.for("TopologyExportService"),
  LocalOrphanBranchWriter: Symbol.for("LocalOrphanBranchWriter"),
};
