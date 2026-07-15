import {
  DocuviaError,
  ErrorCodes,
  type IRemoteSyncClient,
  type RemoteL2NodeSummary,
  type RemoteSyncClientConfig,
  type SyncPushEvent,
  type SyncPushResult,
} from "@workspace/contracts";
import { RemoteApiHttp } from "./constants/http.js";
import { RemoteApiMessages } from "./constants/messages.js";
import { RemoteApiPaths } from "./constants/paths.js";

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
        RemoteApiMessages.CLIENT_USED_BEFORE_INITIALIZE,
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
      res = await fetch(`${apiUrl}${RemoteApiPaths.l2Nodes(projectId)}`, {
        headers: {
          [RemoteApiHttp.HEADER_AUTHORIZATION]: RemoteApiHttp.bearerAuth(pat),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.SYNC_FETCH_FAILED,
        RemoteApiMessages.FETCH_L2_NODES_FAILED,
        err,
      );
    }

    if (!res.ok) {
      const message = await this.parseErrorBody(res);
      throw new DocuviaError(
        ErrorCodes.SYNC_FETCH_FAILED,
        RemoteApiMessages.fetchL2NodesFailedWithReason(message),
      );
    }

    try {
      return (await res.json()) as RemoteL2NodeSummary[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.SYNC_FETCH_FAILED,
        RemoteApiMessages.FETCH_L2_NODES_INVALID_JSON,
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
      res = await fetch(`${apiUrl}${RemoteApiPaths.SYNC_PUSH}`, {
        method: RemoteApiHttp.METHOD_POST,
        headers: {
          [RemoteApiHttp.HEADER_CONTENT_TYPE]: RemoteApiHttp.CONTENT_TYPE_JSON,
          [RemoteApiHttp.HEADER_AUTHORIZATION]: RemoteApiHttp.bearerAuth(pat),
        },
        body: JSON.stringify({ projectId: Number(projectId), events }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.SYNC_PUSH_FAILED,
        RemoteApiMessages.SYNC_PUSH_FAILED,
        err,
      );
    }

    if (!res.ok) {
      const message = await this.parseErrorBody(res);
      throw new DocuviaError(
        ErrorCodes.SYNC_PUSH_FAILED,
        RemoteApiMessages.syncPushFailedWithReason(message),
      );
    }

    try {
      return (await res.json()) as SyncPushResult;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.SYNC_PUSH_FAILED,
        RemoteApiMessages.SYNC_PUSH_INVALID_JSON,
        err,
      );
    }
  }
}
