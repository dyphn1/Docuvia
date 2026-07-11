/**
 * Registration tokens for `docuviaFactory`. One token per interface — implementation
 * libraries register a provider against a token; orchestration resolves by token and only
 * ever sees the associated interface type (declared alongside each token's usage site).
 */
export const TOKENS = {
  GitProvider: Symbol("IGitProvider"),
  KnowledgeGitService: Symbol("IKnowledgeGitService"),
  FileDiscovery: Symbol("IFileDiscovery"),
  ConfigScanner: Symbol("IConfigScanner"),
  VcsScanner: Symbol("IVcsScanner"),
  AstProcessor: Symbol("IAstProcessor"),
  GraphPersister: Symbol("IGraphPersister"),
  TempFileManager: Symbol("ITempFileManager"),
  GraphStoreOpener: Symbol("GraphStoreOpener"),
} as const;

export type Token = (typeof TOKENS)[keyof typeof TOKENS];
