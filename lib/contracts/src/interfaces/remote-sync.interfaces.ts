/**
 * Remote backend sync surface — implemented by `lib/remote-api`'s fetch-backed HTTP client. Pure
 * network I/O with no Docuvia-specific dedup logic (the content-hash cache lives in
 * `lib/ui-core`'s sync workflow); see docs/gitbook/architecture/virtual-contracts-architecture.md's
 * Technology Provider section.
 */
export interface RemoteL2NodeSummary {
  id: number;
  name: string;
  [key: string]: unknown;
}

export interface CreateL3EventPayload {
  l2NodeId: number;
  title: string;
  content?: string | null;
  nodeType?: "change" | "rule" | "decision" | "context";
  confidence?: number | null;
  sourceCommits?: string[];
  contentHash?: string | null;
}

export interface SyncPushEvent {
  type: "CREATE_L3";
  payload: CreateL3EventPayload;
}

export interface SyncPushResult {
  success: boolean;
  processed: number;
}

/** Per-run config — never read from `process.env` inside the implementation (see
 *  docs/gitbook/architecture/application-lifecycle-and-state.md); the Presentation layer reads
 *  `DOCUVIA_API_URL`/`MCP_PAT` and injects them via `docuviaMemory`, and the orchestration layer
 *  passes them into this `initialize()` call. */
export interface RemoteSyncClientConfig {
  apiUrl: string;
  pat: string;
}

export interface IRemoteSyncClient {
  initialize(config: RemoteSyncClientConfig): void;
  fetchRemoteL2Nodes(projectId: string): Promise<RemoteL2NodeSummary[]>;
  pushSyncEvents(
    projectId: string,
    events: SyncPushEvent[],
  ): Promise<SyncPushResult>;
}
