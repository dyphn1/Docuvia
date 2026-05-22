# Implementation Plan: VS Code Extension Phase 5 — Breadth Search Integration (Central Server)

**Date:** 2026-05-22  
**Status:** Ready for implementation  
**Roadmap Reference:** `docs/vscode-extension-roadmap.md` — Phase 5  
**Affected Package:** `@workspace/vscode-client` (`artifacts/vscode-client/`)

---

## 1. Implementation Goals

| # | Goal | Verifiable Success Criterion |
|---|------|------------------------------|
| G1 | Breadth-query routing in Chat | `@docuvia /query how do other projects handle auth` sends `POST {server_url}/query` to the central server and renders results under a "Cross-Project Results" section in the chat stream |
| G2 | Secure token storage | `docuvia.setServerToken` stores a token via `vscode.SecretStorage`; the token is **never** written to disk or logged; `docuvia.clearServerToken` removes it |
| G3 | `x-docuvia-token` auth header | Every central server request includes `x-docuvia-token: <token>` when a token is stored |
| G4 | 401 surfacing | When the server returns `401`, a VS Code error notification appears: _"Docuvia: Authentication required. Run 'Docuvia: Set Server Token'."_ |
| G5 | `SearchResultsPanel` Webview | `docuvia.openSearch` command opens a Webview panel listing results as title / project / L1 tags / snippet |
| G6 | `GlobalConfig` loaded at activation | `~/.docuvia/config.yaml` is read on extension activation using `os.homedir()`; result stored on `KnowledgeStore`; missing file uses default (`server_url: undefined`, `telemetry.enabled: true`) |
| G7 | TypeScript compiles without errors | `pnpm --filter @workspace/vscode-client run typecheck` exits 0 |

---

## 2. Architecture Overview

```
extension.ts (activate)
  ├── parseGlobalConfig(~/.docuvia/config.yaml) → GlobalConfig
  ├── store.setGlobalConfig(config)                 ← NEW on KnowledgeStore
  ├── new CredentialManager(context.secrets)        ← NEW
  ├── new CentralServerClient(store, credMgr)       ← NEW
  ├── registerDocuviaChatParticipant(ctx, store, taskRunner, centralClient)
  ├── register docuvia.setServerToken command
  ├── register docuvia.clearServerToken command
  └── register docuvia.openSearch command → SearchResultsPanel.createOrShow(...)
```

```
ChatParticipant.handleQuery
  ├── isBreadthQuery(query)?  ──Yes──▶  CentralServerClient.query(q, limit)
  │                                          ├── 401 → show notification, return
  │                                          └── results → stream "Cross-Project Results"
  └── No ──▶  local KnowledgeStore search (existing logic, unchanged)
```

---

## 3. New Files

### 3.1 `artifacts/vscode-client/src/CredentialManager.ts`

**Purpose:** Thin wrapper around `vscode.SecretStorage` for the Docuvia API token.

```typescript
// Key used in SecretStorage — must be stable across versions
const SECRET_KEY = 'docuvia.serverToken';

export class CredentialManager {
  constructor(private readonly _secrets: vscode.SecretStorage) {}

  async getToken(): Promise<string | undefined> {
    return this._secrets.get(SECRET_KEY);
  }

  async setToken(token: string): Promise<void> {
    await this._secrets.store(SECRET_KEY, token);
  }

  async clearToken(): Promise<void> {
    await this._secrets.delete(SECRET_KEY);
  }
}
```

**Security notes:**
- `vscode.SecretStorage` maps to OS keychain (macOS Keychain, Windows Credential Manager, libsecret on Linux) — tokens never touch the file system.
- No logging of the token value anywhere in this class.

---

### 3.2 `artifacts/vscode-client/src/CentralServerClient.ts`

**Purpose:** Single-responsibility HTTP client for the central Docuvia server.

#### TypeScript interfaces

```typescript
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

/** Shape of the 401 error thrown by the client */
export class CentralServerAuthError extends Error {
  readonly statusCode = 401;
}
```

#### Class skeleton

```typescript
export class CentralServerClient {
  constructor(
    private readonly _store: KnowledgeStore,
    private readonly _creds: CredentialManager
  ) {}

  /**
   * Sends a breadth search query to the central server.
   * Throws CentralServerAuthError on 401.
   * Returns empty array if server_url is not configured.
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
}
```

**Security notes:**
- No token in logs.
- Server URL is read from `GlobalConfig` (user-controlled, from `~/.docuvia/config.yaml`) — never hardcoded.
- `fetch` is the Node 24 built-in; no additional dependencies needed.
- The `serverUrl` is validated as a proper URL at parse time by `GlobalConfigSchema` (`z.string().url()`), preventing SSRF from malformed values.

---

### 3.3 `artifacts/vscode-client/src/SearchResultsPanel.ts`

**Purpose:** Webview panel that renders cross-project search results in a structured list.  
**Pattern:** Mirrors `DashboardPanel.ts` exactly — singleton static `createOrShow`, nonce-secured CSP, no external resource loading.

#### Message types

```typescript
interface SearchResultsMessage {
  type: 'results';
  query: string;
  results: CentralSearchResult[];
}
```

#### Class outline

```typescript
export class SearchResultsPanel {
  static readonly viewType = 'docuvia.searchResults';
  private static _current: SearchResultsPanel | undefined;

  static createOrShow(
    context: vscode.ExtensionContext,
    query: string,
    results: CentralSearchResult[]
  ): void { ... }

  private constructor(
    private readonly _panel: vscode.WebviewPanel,
    private readonly _context: vscode.ExtensionContext
  ) { ... }

  pushResults(query: string, results: CentralSearchResult[]): void { ... }

  private _buildHtml(): string { ... /* nonce, CSP identical to DashboardPanel */ }
}
```

**HTML structure** (rendered in `_buildHtml`):
- Title bar: "Docuvia: Search Results"
- Query display: `<div class="query-label">Results for: <em>{query}</em></div>`
- Results list: for each `CentralSearchResult`:
  - `<div class="result-card">`
    - `<div class="result-title">{title}</div>`
    - `<div class="result-meta">{projectName} · {l1Tags.join(', ')}</div>`
    - `<div class="result-snippet">{snippet}</div>`
  - `</div>`
- Empty state: "No cross-project results found."

CSP: `default-src 'none'; style-src {cspSource} 'nonce-{nonce}'; script-src 'nonce-{nonce}';`

---

## 4. Changes to Existing Files

### 4.1 `KnowledgeStore.ts`

**Add `globalConfig` property** so `CentralServerClient` can read `server_url` without a separate singleton.

```typescript
// Add field
private _globalConfig: GlobalConfig | null = null;

// Add getter
get globalConfig(): GlobalConfig | null {
  return this._globalConfig;
}

// Add setter (called once from extension.ts activate)
setGlobalConfig(config: GlobalConfig): void {
  this._globalConfig = config;
}
```

**Import addition:** `import { GlobalConfig } from './types.js';`

---

### 4.2 `ChatParticipant.ts`

#### New import
```typescript
import { CentralServerClient, CentralServerAuthError } from './CentralServerClient.js';
```

#### Update `registerDocuviaChatParticipant` signature
```typescript
export function registerDocuviaChatParticipant(
  context: vscode.ExtensionContext,
  store: KnowledgeStore,
  taskRunner: TaskRunner,
  centralClient: CentralServerClient   // ← NEW parameter
): vscode.ChatParticipant
```

#### Update `handleQuery` call site in handler
```typescript
case 'query':
  return handleQuery(request, stream, store, centralClient);
```

#### Replace `handleQuery` stub with full implementation

Replace the existing `handleQuery` function (currently ending with the `// TODO Phase 5` comment block) with:

```typescript
async function handleQuery(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  store: KnowledgeStore,
  centralClient: CentralServerClient
): Promise<void> {
  const query = request.prompt.trim().toLowerCase();
  if (!query) {
    stream.markdown(
      'Usage: `/query <search term>` — searches your local `.docuvia` knowledge graph.'
    );
    return;
  }

  // ── Breadth routing ────────────────────────────────────────────────────────
  if (isBreadthQuery(query)) {
    await handleBreadthQuery(query, stream, centralClient);
    return;
  }

  // ── Local depth search (unchanged existing logic) ─────────────────────────
  const snapshot = store.snapshot;
  if (!snapshot) {
    stream.markdown('No `.docuvia/` folder loaded. Run **Docuvia: Init Project** first.');
    return;
  }

  const matchingModules = snapshot.modules.filter(
    (m) =>
      m.name.toLowerCase().includes(query) ||
      m.slug.includes(query) ||
      (m.description ?? '').toLowerCase().includes(query)
  );

  const matchingDecisions = [...snapshot.decisions.values()].filter(
    (d) => d.title.toLowerCase().includes(query) || d.body.toLowerCase().includes(query)
  );

  if (matchingModules.length === 0 && matchingDecisions.length === 0) {
    stream.markdown(`No local results found for **"${query}"**.`);
    return;
  }

  if (matchingModules.length > 0) {
    stream.markdown(
      `### Matching L2 Modules\n` +
        matchingModules
          .map((m) => `- **${m.name}** (\`${m.slug}\`) — ${m.description ?? ''}`)
          .join('\n')
    );
  }

  if (matchingDecisions.length > 0) {
    stream.markdown(
      `### Matching L3 Decisions\n` +
        matchingDecisions
          .slice(0, 5)
          .map((d) => `- **${d.title}** [${d.status}] — \`${d.filePath}\``)
          .join('\n')
    );
  }
}

/** Detect cross-project "breadth" queries that should be routed to the central server. */
function isBreadthQuery(query: string): boolean {
  const breadthPatterns = [
    'other projects',
    'cross-project',
    'how do others',
    'how do other',
  ];
  return query.startsWith('@') || breadthPatterns.some((p) => query.includes(p));
}

async function handleBreadthQuery(
  query: string,
  stream: vscode.ChatResponseStream,
  centralClient: CentralServerClient
): Promise<void> {
  stream.progress('Searching cross-project knowledge...');
  try {
    const results = await centralClient.query(query, 10);
    if (results.length === 0) {
      stream.markdown(
        `No cross-project results found for **"${query}"**.` +
          (centralClient.isServerConfigured()
            ? ''
            : '\n\n_Tip: Configure `server_url` in `~/.docuvia/config.yaml` to enable cross-project search._')
      );
      return;
    }
    stream.markdown(`### Cross-Project Results\n`);
    for (const r of results) {
      const tags = r.l1Tags.length > 0 ? ` · \`${r.l1Tags.join('`, `')}\`` : '';
      stream.markdown(
        `**${r.title}** — _${r.projectName}_${tags}\n> ${r.snippet}\n`
      );
    }
  } catch (err) {
    if (err instanceof CentralServerAuthError) {
      void vscode.window.showErrorMessage(
        "Docuvia: Authentication required. Run 'Docuvia: Set Server Token'."
      );
      stream.markdown("_Authentication required. Set your server token via the Command Palette: **Docuvia: Set Server Token**._");
    } else {
      stream.markdown(`_Cross-project search failed: ${String(err)}_`);
    }
  }
}
```

Also add a helper method to `CentralServerClient` (see §3.2 amendment below):
```typescript
isServerConfigured(): boolean {
  return !!this._store.globalConfig?.server_url;
}
```

---

### 4.3 `extension.ts`

#### New imports
```typescript
import * as os from 'os';
import * as path from 'path';
import { CredentialManager } from './CredentialManager.js';
import { CentralServerClient } from './CentralServerClient.js';
import { SearchResultsPanel } from './SearchResultsPanel.js';
import { parseGlobalConfig } from './parser.js';
```

*(Note: `path` is already imported — skip that duplicate.)*

#### Global config loading at start of `activate`
Insert immediately after `const store = KnowledgeStore.getInstance(outputChannel);`:

```typescript
// ─── Global Config ────────────────────────────────────────────────────────
const globalConfigPath = path.join(os.homedir(), '.docuvia', 'config.yaml');
const globalConfig = parseGlobalConfig(globalConfigPath);
store.setGlobalConfig(globalConfig);
outputChannel.appendLine(
  `[Docuvia] Global config loaded. server_url=${globalConfig.server_url ?? '(none)'}`
);
```

#### Instantiate CredentialManager and CentralServerClient
Insert after global config block:

```typescript
// ─── Credential Manager & Central Server Client ───────────────────────────
const credentialManager = new CredentialManager(context.secrets);
const centralClient = new CentralServerClient(store, credentialManager);
```

#### Update chat participant registration
```typescript
const chatParticipant = registerDocuviaChatParticipant(context, store, taskRunner, centralClient);
```

#### New commands
Add alongside the existing command registrations:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('docuvia.setServerToken', async () => {
    const token = await vscode.window.showInputBox({
      prompt: 'Enter your Docuvia server API token',
      password: true,
      placeHolder: 'docuvia_token_...',
    });
    if (token && token.trim().length > 0) {
      await credentialManager.setToken(token.trim());
      void vscode.window.showInformationMessage('Docuvia: Server token saved.');
    }
  })
);

context.subscriptions.push(
  vscode.commands.registerCommand('docuvia.clearServerToken', async () => {
    await credentialManager.clearToken();
    void vscode.window.showInformationMessage('Docuvia: Server token cleared.');
  })
);

context.subscriptions.push(
  vscode.commands.registerCommand('docuvia.openSearch', async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Search cross-project knowledge',
      placeHolder: 'e.g. how do other projects handle auth',
    });
    if (!query || query.trim().length === 0) return;
    const q = query.trim();
    stream.progress?.('Searching...'); // placeholder — open panel then populate
    try {
      const results = await centralClient.query(q, 20);
      SearchResultsPanel.createOrShow(context, q, results);
    } catch (err) {
      if (err instanceof CentralServerAuthError) {
        void vscode.window.showErrorMessage(
          "Docuvia: Authentication required. Run 'Docuvia: Set Server Token'."
        );
      } else {
        void vscode.window.showErrorMessage(`Docuvia: Search failed — ${String(err)}`);
      }
    }
  })
);
```

*(Import `CentralServerAuthError` from `CentralServerClient.js` in extension.ts.)*

---

### 4.4 `package.json` (contributes)

#### New commands

```jsonc
{
  "command": "docuvia.setServerToken",
  "title": "Docuvia: Set Server Token"
},
{
  "command": "docuvia.clearServerToken",
  "title": "Docuvia: Clear Server Token"
},
{
  "command": "docuvia.openSearch",
  "title": "Docuvia: Open Cross-Project Search",
  "icon": "$(search)"
}
```

#### New menu entry (view/title for knowledgeGraph panel)

```jsonc
{
  "command": "docuvia.openSearch",
  "when": "view == docuvia.knowledgeGraph",
  "group": "navigation"
}
```

---

## 5. Detailed Implementation Steps

### Step 1 — `KnowledgeStore.ts`: add `globalConfig` field

1. Add `import { GlobalConfig } from './types.js';` (already in scope via types, verify).
2. Add `private _globalConfig: GlobalConfig | null = null;` field.
3. Add `get globalConfig()` getter.
4. Add `setGlobalConfig(config: GlobalConfig): void` method.

**Success criterion:** `store.globalConfig` returns `null` before `setGlobalConfig` is called and the parsed config afterward.

---

### Step 2 — `CredentialManager.ts`: create file

Full class as described in §3.1.

**Success criterion:** Calling `setToken('abc')` then `getToken()` returns `'abc'`; `clearToken()` then `getToken()` returns `undefined`.

---

### Step 3 — `CentralServerClient.ts`: create file

Full class as described in §3.2, including:
- `CentralQueryRequest` interface
- `CentralSearchResult` interface
- `CentralServerAuthError` class
- `CentralServerClient` class with `query()` and `isServerConfigured()` methods

**Success criterion:**
- When `store.globalConfig?.server_url` is `undefined`, `query()` returns `[]`.
- When server returns `401`, `CentralServerAuthError` is thrown.
- When server returns `200`, the parsed `CentralSearchResult[]` is returned.

---

### Step 4 — `SearchResultsPanel.ts`: create file

Webview panel following `DashboardPanel.ts` pattern precisely:
- Singleton with `static _current`.
- `createOrShow(context, query, results)` — create or reveal and push new data.
- `pushResults(query, results)` — post message to webview.
- `_buildHtml()` — returns HTML with nonce-based CSP.
- HTML renders a result card per `CentralSearchResult`: title, project name, L1 tags badges, snippet paragraph.

**Success criterion:** `docuvia.openSearch` command opens a Webview panel. Running the command a second time re-uses the existing panel.

---

### Step 5 — `ChatParticipant.ts`: route breadth queries

1. Update function signature to accept `centralClient: CentralServerClient`.
2. Add `isBreadthQuery(query): boolean` helper.
3. Add `handleBreadthQuery(query, stream, centralClient): Promise<void>`.
4. Replace the `TODO Phase 5` block in `handleQuery` with calls to the above.

**Success criterion:** Sending `/query how do other projects handle auth` when `server_url` is configured causes a `POST /query` request. Sending `/query auth module` stays local.

---

### Step 6 — `extension.ts`: wire everything together

1. Load global config from `~/.docuvia/config.yaml` via `parseGlobalConfig`.
2. Call `store.setGlobalConfig(config)`.
3. Instantiate `CredentialManager` and `CentralServerClient`.
4. Pass `centralClient` to `registerDocuviaChatParticipant`.
5. Register `docuvia.setServerToken`, `docuvia.clearServerToken`, `docuvia.openSearch` commands.

**Success criterion:** Extension activates without errors; `outputChannel` logs `Global config loaded.` line.

---

### Step 7 — `package.json`: register new contributions

Add commands and menu entry as detailed in §4.4.

**Success criterion:** Command Palette shows all three new Docuvia commands.

---

## 6. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Token storage | `vscode.SecretStorage` (OS keychain) — never written to YAML or logged |
| Token in logs | `CredentialManager` never logs the token; `extension.ts` only logs `server_url` (not the token) |
| SSRF via `server_url` | `GlobalConfigSchema` validates `server_url` as `z.string().url()` — rejects non-URL strings before they reach `fetch` |
| XSS in Webview | `SearchResultsPanel` uses nonce-based CSP identical to `DashboardPanel`; result text is rendered as text content (not innerHTML) via JavaScript `textContent` assignments |
| 401 escalation | On `401`, the extension notifies the user — it does not auto-retry or store the failed token |

---

## 7. Files Summary

| Action | File |
|--------|------|
| CREATE | `artifacts/vscode-client/src/CredentialManager.ts` |
| CREATE | `artifacts/vscode-client/src/CentralServerClient.ts` |
| CREATE | `artifacts/vscode-client/src/SearchResultsPanel.ts` |
| MODIFY | `artifacts/vscode-client/src/KnowledgeStore.ts` |
| MODIFY | `artifacts/vscode-client/src/ChatParticipant.ts` |
| MODIFY | `artifacts/vscode-client/src/extension.ts` |
| MODIFY | `artifacts/vscode-client/package.json` |

No new npm dependencies are required (Node 24 built-in `fetch` is sufficient; `vscode.SecretStorage` is a built-in VS Code API).

---

## 8. Out of Scope (Phase 5 Boundaries)

- Full OAuth 2.0 / PKCE flow (RBAC stub only — token-based with upgrade hook)
- Team/project-level access control enforcement (deferred to Phase 6+)
- Streaming responses from central server
- Result caching / offline support
