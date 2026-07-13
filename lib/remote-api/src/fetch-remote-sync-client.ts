import {
  DocuviaError,
  ErrorCodes,
  type IRemoteSyncClient,
  type RemoteL2NodeSummary,
  type RemoteSyncClientConfig,
  type SyncPushEvent,
  type SyncPushResult,
} from "@workspace/contracts";

const REQUEST_TIMEOUT_MS = 30000;

/**
 * Native-`fetch`-backed remote sync HTTP client — the Technology Provider wrapping the remote
 * Docuvia backend's `/projects/:id/l2-nodes` and `/sync/push` endpoints (see
 * docs/gitbook/architecture/virtual-contracts-architecture.md's Technology Provider section). A
 * Silent Worker — takes no `ILogger` — and never leaks a native error; every failure is caught
 * and wrapped as `DocuviaError`. Config (`apiUrl`/`pat`) is injected via `initialize()`, never
 * read from `process.env` directly (see
 * docs/gitbook/architecture/application-lifecycle-and-state.md).
 */
export class FetchRemoteSyncClient implements IRemoteSyncClient {
  private config: RemoteSyncClientConfig | undefined;

  public initialize(config: RemoteSyncClientConfig): void {
    this.config = config;
  }

  private getConfig(): RemoteSyncClientConfig {
    if (!this.config) {
      throw new DocuviaError(
        ErrorCodes.SYNC_FETCH_FAILED,
        "FetchRemoteSyncClient used before initialize() was called",
      );
    }
    return this.config;
  }

  private async parseErrorBody(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: string };
      return body.error ?? res.statusText;
    } catch {
      return res.statusText;
    }
  }

  public async fetchRemoteL2Nodes(
    projectId: string,
  ): Promise<RemoteL2NodeSummary[]> {
    const { apiUrl, pat } = this.getConfig();
    let res: Response;
    try {
      res = await fetch(`${apiUrl}/projects/${projectId}/l2-nodes`, {
        headers: { Authorization: `Bearer ${pat}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.SYNC_FETCH_FAILED,
        "Failed to fetch remote L2 nodes",
        err,
      );
    }

    if (!res.ok) {
      const message = await this.parseErrorBody(res);
      throw new DocuviaError(
        ErrorCodes.SYNC_FETCH_FAILED,
        `Failed to fetch remote L2 nodes: ${message}`,
      );
    }

    try {
      return (await res.json()) as RemoteL2NodeSummary[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.SYNC_FETCH_FAILED,
        "Failed to fetch remote L2 nodes: response body was not valid JSON",
        err,
      );
    }
  }

  public async pushSyncEvents(
    projectId: string,
    events: SyncPushEvent[],
  ): Promise<SyncPushResult> {
    const { apiUrl, pat } = this.getConfig();
    let res: Response;
    try {
      res = await fetch(`${apiUrl}/sync/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pat}`,
        },
        body: JSON.stringify({ projectId: Number(projectId), events }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.SYNC_PUSH_FAILED,
        "Sync push failed",
        err,
      );
    }

    if (!res.ok) {
      const message = await this.parseErrorBody(res);
      throw new DocuviaError(
        ErrorCodes.SYNC_PUSH_FAILED,
        `Sync push failed: ${message}`,
      );
    }

    try {
      return (await res.json()) as SyncPushResult;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.SYNC_PUSH_FAILED,
        "Sync push failed: response body was not valid JSON",
        err,
      );
    }
  }
}
