import { CredentialManager } from "./CredentialManager.js";
import { KnowledgeStore } from "./KnowledgeStore.js";
import { KnowledgeSnapshot } from "./types.js";

/** Request body for POST /query */
export interface CentralQueryRequest {
  q: string;
  limit: number;
}

/** Single result item returned from the central server */
export interface CentralSearchResult {
  title: string;
  projectName: string;
  l1Tags: string[];
  snippet: string;
  score?: number;
}

/** Thrown when the central server responds with 401 */
export class CentralServerAuthError extends Error {
  readonly statusCode = 401;

  constructor(message = "Unauthorized") {
    super(message);
    this.name = "CentralServerAuthError";
  }
}

export class CentralServerClient {
  constructor(
    private readonly _store: KnowledgeStore,
    private readonly _creds: CredentialManager
  ) {}

  isServerConfigured(): boolean {
    return !!this._store.globalConfig?.server_url;
  }

  /**
   * Sends a breadth search query to the central server.
   * Returns an empty array if server_url is not configured.
   * Throws CentralServerAuthError on 401.
   */
  async query(q: string, limit = 10): Promise<CentralSearchResult[]> {
    if (process.env.DOCUVIA_MOCK_SERVER === "1") {
      return [
        {
          title: "Mocked Result",
          projectName: "mock-project",
          l1Tags: ["mock-tag"],
          snippet: "This is a mocked snippet for E2E testing.",
          score: 1.0,
        },
      ];
    }

    const serverUrl = this._store.globalConfig?.server_url;
    if (!serverUrl) {
      return [];
    }

    const token = await this._creds.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["x-docuvia-token"] = token;
    }

    const body: CentralQueryRequest = { q, limit };
    const response = await fetch(`${serverUrl}/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      throw new CentralServerAuthError("Unauthorized");
    }

    if (!response.ok) {
      throw new Error(`Central server error: ${response.status}`);
    }

    return response.json() as Promise<CentralSearchResult[]>;
  }

  // TODO (Phase 6): OAuth2/PKCE flow — integrate with enterprise IdP for RBAC
  async checkAuthorizationScope(_scope: string): Promise<boolean> {
    // Default: allow all for simple/internal deployments
    return true;
  }

  /**
   * Triggers the sync pipeline for a project branch push.
   * Calls POST /sync/push with the project ID and CQRS outbox events.
   */
  async sync(projectId: number, branch: string, commits: string[]): Promise<void> {
    if (process.env.DOCUVIA_MOCK_SERVER === "1") {
      return;
    }

    const serverUrl = this._store.globalConfig?.server_url;
    if (!serverUrl) return;

    const token = await this._creds.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["x-docuvia-token"] = token;
    }

    // Map pushes to standard outbox events
    const events = commits.map(commit => ({
      type: "UPDATE_L3",
      payload: { commitHash: commit, branchName: branch }
    }));

    const response = await fetch(`${serverUrl}/sync/push`, {
      method: "POST",
      headers,
      body: JSON.stringify({ projectId, events }),
    });

    if (response.status === 401) {
      throw new CentralServerAuthError();
    }
    if (!response.ok) {
      throw new Error(`Sync failed: ${response.status}`);
    }
  }

  /**
   * Pulls the full knowledge snapshot for a project from the server.
   * Calls GET /projects/{id}/graph which returns L1 tags, L2 nodes, and L3 nodes.
   */
  async pullSnapshot(projectId: number): Promise<KnowledgeSnapshot> {
    if (process.env.DOCUVIA_MOCK_SERVER === "1") {
      return {
        projectId,
        l1Tags: [{ id: 1, name: "Mock L1 Tag", category: "General", description: "Mock tag" }],
        l2Nodes: [
          {
            id: 1,
            projectId,
            name: "Mock L2 Module",
            type: "module",
            description: "Mock module",
            l1TagIds: [1],
          },
        ],
        l3Nodes: [
          {
            id: 1,
            l2NodeId: 1,
            title: "Mock L3 Decision",
            content: "Mock content",
            nodeType: "decision",
          },
        ],
      };
    }

    const serverUrl = this._store.globalConfig?.server_url;
    if (!serverUrl) {
      throw new Error("Server URL not configured");
    }

    const token = await this._creds.getToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["x-docuvia-token"] = token;
    }

    const response = await fetch(`${serverUrl}/projects/${projectId}/graph`, { headers });

    if (response.status === 401) {
      throw new CentralServerAuthError();
    }
    if (!response.ok) {
      throw new Error(`Failed to pull snapshot: ${response.status}`);
    }

    return response.json() as Promise<KnowledgeSnapshot>;
  }

  private _heartbeatTimeout?: NodeJS.Timeout;

  startHeartbeat(): void {
    if (this._heartbeatTimeout) {
      clearTimeout(this._heartbeatTimeout);
    }
    this._scheduleNextHeartbeat();
  }

  private _scheduleNextHeartbeat(): void {
    const baseDelay = 5 * 60 * 1000; // 5 minutes
    const jitter = (Math.random() - 0.5) * 2 * 60 * 1000; // ± 1 minute
    const delay = baseDelay + jitter;

    this._heartbeatTimeout = setTimeout(async () => {
      await this._tickMetabolism();
      this._scheduleNextHeartbeat();
    }, delay);
  }

  private async _tickMetabolism(): Promise<void> {
    const serverUrl = this._store.globalConfig?.server_url;
    if (!serverUrl) return;

    try {
      const token = await this._creds.getToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers["x-docuvia-token"] = token;
      }
      await fetch(`${serverUrl}/api/metabolism-tick`, { headers });
    } catch (error) {
      // Ignore network errors for heartbeat
    }
  }

  async sendFeedback(id: number, nodeLayer: "l2" | "l3"): Promise<void> {
    const serverUrl = this._store.globalConfig?.server_url;
    if (!serverUrl) return;

    const token = await this._creds.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["x-docuvia-token"] = token;
    }

    try {
      await fetch(`${serverUrl}/api/search/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id, nodeLayer }),
      });
    } catch (error) {
      // Feedback failure shouldn't crash the UI
    }
  }
}
