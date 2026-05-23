import { CredentialManager } from './CredentialManager.js';
import { KnowledgeStore } from './KnowledgeStore.js';

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

  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'CentralServerAuthError';
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
    const serverUrl = this._store.globalConfig?.server_url;
    if (!serverUrl) {
      return [];
    }

    const token = await this._creds.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['x-docuvia-token'] = token;
    }

    const body: CentralQueryRequest = { q, limit };
    const response = await fetch(`${serverUrl}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      throw new CentralServerAuthError('Unauthorized');
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
}
