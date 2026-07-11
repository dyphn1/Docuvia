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

export type { ChangedFileEntry, IGitProvider } from "./interfaces/git.interfaces.js";
export type { IKnowledgeGitService } from "./interfaces/knowledge-git.interfaces.js";
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
  IProjectsRepo,
  IProjectFilesRepo,
  ITagsRepo,
  IGraphNodesRepo,
  IFtsRepo,
  IGraphStore,
  GraphStoreOpenOptions,
} from "./interfaces/graph-store.interfaces.js";
export type { IGraphPersister } from "./interfaces/graph-persister.interfaces.js";

export { createMockLogger, resetFactoryForTests } from "./testing/mocks.js";
export type { MockLogger } from "./testing/mocks.js";

export type { ITempFileManager } from "./interfaces/temp-file-manager.interfaces.js";

export {
  DOCUVIA_DIR_NAME,
  DOCUVIA_LOGS_DIR_NAME,
  INIT_LOG_FILE_NAME,
  LOCAL_DB_FILE_NAME,
} from "./constants/paths.js";
