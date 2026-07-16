export type { ILogger, LogEvent, LogLevel } from "./logging/types.js";
export { Logger, createNoopLogger } from "./logging/logger.js";
export type { IIpcLogMessage } from "./logging/ipc-log-message.js";
export { isIpcLogMessage } from "./logging/ipc-log-message.js";
export { IpcLoggerClient } from "./logging/ipc-logger-client.js";
export { IpcLogRouter } from "./logging/ipc-log-router.js";

export { ErrorCodes } from "./errors/error-codes.js";
export type { ErrorCode } from "./errors/error-codes.js";
export { DocuviaError } from "./errors/docuvia-error.js";

export { DocuviaMemory, docuviaMemory } from "./memory/docuvia-memory.js";

export { DocuviaFactory, docuviaFactory } from "./factory/docuvia-factory.js";
export type { Provider } from "./factory/docuvia-factory.js";
export { TOKENS, createToken } from "./factory/tokens.js";
export type { Token } from "./factory/tokens.js";

export type {
  ChangedFileEntry,
  DiffLineRange,
  IGitProvider,
} from "./interfaces/git.interfaces.js";
export type {
  SemanticPruningLevel,
  SemanticDiffModifiedNode,
  ISemanticDiffAnalyzer,
} from "./interfaces/semantic-diff.interfaces.js";
export type {
  IKnowledgeGitService,
  KnowledgeBranchSyncResult,
} from "./interfaces/knowledge-git.interfaces.js";
export type {
  DiscoveredFile,
  DiscoveryResult,
  FileHashLookup,
  IFileDiscovery,
  IConfigScanner,
  IVcsScanner,
} from "./interfaces/discovery.interfaces.js";
export type {
  AstImportDescriptor,
  ParsedAstFileData,
  ParsedAstFileResult,
  AstParseFailure,
  AstProcessResult,
  IAstProcessor,
} from "./interfaces/ast.interfaces.js";
export type {
  ProjectRow,
  ProjectFileRow,
  L1TagRow,
  L2NodeRow,
  NodeLinkRow,
  L2NodeL1TagRow,
  L3NodeRow,
  L2NodeWithL3Children,
  IProjectsRepo,
  IProjectFilesRepo,
  ITagsRepo,
  IGraphNodesRepo,
  IL3NodesRepo,
  IFtsRepo,
  IMetaRepo,
  IGraphStore,
  GraphStoreOpenOptions,
} from "./interfaces/graph-store.interfaces.js";
export type {
  HydrationResult,
  IHydrationService,
} from "./interfaces/hydration.interfaces.js";
export type { IGraphPersister } from "./interfaces/graph-persister.interfaces.js";
export type {
  RemoteL2NodeSummary,
  CreateL3EventPayload,
  SyncPushEvent,
  SyncPushResult,
  RemoteSyncClientConfig,
  IRemoteSyncClient,
} from "./interfaces/remote-sync.interfaces.js";
export type {
  LlmClientConfig,
  ChatMessageRole,
  ChatToolCall,
  ChatMessage,
  ChatToolDefinition,
  ChatCompletionRequest,
  ChatCompletionChoice,
  ChatCompletionResult,
  ChatCompletionChunkDelta,
  ChatCompletionChunkChoice,
  ChatCompletionChunk,
  ILlmClient,
} from "./interfaces/llm-client.interfaces.js";
export { RiskLevels } from "./interfaces/impact.interfaces.js";
export type {
  RiskLevel,
  BlastRadiusEntry,
  IImpactService,
} from "./interfaces/impact.interfaces.js";
export type {
  ChangeDetectionResult,
  IChangeDetectionService,
} from "./interfaces/change-detection.interfaces.js";
export type {
  GraphEdgeRef,
  GraphContext,
  LocalSearchResult,
  LocalQueryResult,
  IQueryService,
} from "./interfaces/query.interfaces.js";
export { TOPOLOGY_VERSION } from "./interfaces/topology.interfaces.js";
export type {
  TopologyNodeKind,
  TopologyCollapseMode,
  TopologyNode,
  TopologyLink,
  TopologyGroup,
  TopologyStats,
  TopologyGraph,
  TopologyExportOptions,
  TopologyBuildInput,
  ITopologyBuilder,
} from "./interfaces/topology.interfaces.js";
export type {
  SnapshotRenderInput,
  SnapshotRenderResult,
  ISnapshotRenderer,
} from "./interfaces/snapshot.interfaces.js";

export { createMockLogger, resetFactoryForTests } from "./testing/mocks.js";
export type { MockLogger } from "./testing/mocks.js";

export type { ITempFileManager } from "./interfaces/temp-file-manager.interfaces.js";

export {
  DOCUVIA_DIR_NAME,
  DOCUVIA_LOGS_DIR_NAME,
  INIT_LOG_FILE_NAME,
  CLEAN_LOG_FILE_NAME,
  STATUS_LOG_FILE_NAME,
  SYNC_LOG_FILE_NAME,
  ANALYZE_LOG_FILE_NAME,
  REVIEW_LOG_FILE_NAME,
  IMPACT_LOG_FILE_NAME,
  QUERY_LOG_FILE_NAME,
  EXPORT_TOPOLOGY_LOG_FILE_NAME,
  SNAPSHOT_LOG_FILE_NAME,
  HYDRATE_LOG_FILE_NAME,
  SYNC_KNOWLEDGE_LOG_FILE_NAME,
  LOCAL_DB_FILE_NAME,
  SYNC_STATE_FILE_NAME,
  INIT_COMMAND_LOCK_FILE_NAME,
} from "./constants/paths.js";

export { UTF8_ENCODING } from "./constants/encoding.js";
export { acquireProcessLock } from "./utils/process-lock.js";
export type {
  ProcessLockOptions,
  ProcessLockHandle,
} from "./utils/process-lock.js";
export { DiagnosticStatus } from "./interfaces/diagnostic.interfaces.js";
export type {
  DiagnosticResult,
  IDiagnosticRunner,
  DiagnosticStatusType,
} from "./interfaces/diagnostic.interfaces.js";
export type { IIntegrationManager } from "./interfaces/integration.interfaces.js";
