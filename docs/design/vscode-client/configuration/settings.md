> **DEPRECATION NOTICE**: This document describes legacy client-side implementations (`KnowledgeStore`, `TaskRunner`, `CentralServerClient`). Per [ADR-021](../../adrs/ADR-021-shared-core-api-and-presentation-layers.md), these responsibilities have moved to the Shared Core API (`@workspace/core`). This document is pending a rewrite.

> **DEPRECATION NOTICE**: This document describes legacy client-side implementations (`KnowledgeStore`, `TaskRunner`, `CentralServerClient`). Per [ADR-021](../../adrs/ADR-021-shared-core-api-and-presentation-layers.md), these responsibilities have moved to the Shared Core API (`@workspace/core`). This document is pending a rewrite.

# Docuvia Configuration Settings

Defined in [`package.json`](../../../../artifacts/vscode-client/package.json) -> `contributes.configuration`.

## Settings List

### `docuvia.search.defaultView`

- **Type**: `string`
- **Default**: `"chat"`
- **Enum**: `["chat", "webview"]`
- **Description**: Where to display cross-project search results by default (governed by [Local-First Architecture](../../adrs/ADR-002-local-first-architecture.md) and [Agentic RAG Routing](../../adrs/ADR-007-agentic-rag-routing.md)). If set to `chat`, it pre-fills the GitHub Copilot Chat with `@docuvia /query <text>`. If set to `webview`, it opens a dedicated VS Code webview panel.

### `docuvia.extraction.includePatterns`

- **Type**: `array` of `string`
- **Default**: `["**/*.ts", "**/*.js", "**/*.tsx", "**/*.jsx", "**/*.py", "**/*.rs", "**/*.go", "**/*.java", "**/package.json", "**/pyproject.toml"]`
- **Description**: Glob patterns for files that should be analyzed automatically when triggering "Run Extraction" via the [AST Microkernel](../../adrs/ADR-020-unified-isomorphic-ast-microkernel.md). Evaluated using `minimatch`. Files not matching this list will trigger a confirmation prompt before extraction to respect [Token Management](../../adrs/ADR-009-token-management.md) boundaries.

### `docuvia.extraction.maxLinesWarning`

- **Type**: `number`
- **Default**: `1000`
- **Description**: Show a warning before extracting files larger than this many lines. Encourages the user to use "Add Decision from Selection" for large files instead of sending the entire file to the LLM, triggering [Context Compression](../../adrs/ADR-010-context-compression-and-proxy.md).

### `docuvia.extraction.maxFileSizeKBWarning`

- **Type**: `number`
- **Default**: `50`
- **Description**: Show a warning before extracting files larger than this size in KB. Acts as a second layer of token-consumption protection ([Token Management](../../adrs/ADR-009-token-management.md)) alongside line count limits.

### `docuvia.knowledgeGraph.incrementalUpdateThreshold`

- **Type**: `number`
- **Default**: `50`
- **Description**: Maximum number of files modified in a batch before forcing a full Knowledge Graph reload instead of an incremental update.

### `docuvia.knowledgeGraph.incrementalUpdateRatioThreshold`

- **Type**: `number`
- **Default**: `0.5`
- **Description**: Maximum ratio (0.0 to 1.0) of modified files relative to total `.docuvia` files before forcing a full Knowledge Graph reload.

> ⚠️ **CONFLICT**: `docuvia.extraction.maxFileSizeKBWarning`, `docuvia.knowledgeGraph.incrementalUpdateThreshold`, and `docuvia.knowledgeGraph.incrementalUpdateRatioThreshold` are **not present** in `package.json`'s `contributes.configuration`. These three settings are documented here and in other design docs, but VS Code users cannot discover or modify them via the Settings UI. They must be added to `package.json` in Round 2.

---

## Global Config (`~/.docuvia/local.db`)

In addition to VS Code workspace settings, Docuvia reads a **global user-level config file** at activation time. This file applies across all workspaces on the machine.

- **Database path**: `~/.docuvia/local.db` (resolved via `os.homedir()`)
- **Read at**: Extension activation (`extension.ts` → before `store.load()`)
- **Stored in**: `KnowledgeStore.globalConfig` and passed to `TaskRunner`

### Schema (Zod-validated — `GlobalConfigSchema`)

| Field               | Type                 | Default   | Description                                                                                                         |
| ------------------- | -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `server_url`        | `string` (HTTPS URL) | _(unset)_ | URL of the central Docuvia server. Must use `https://`.                                                             |
| `chunking_strategy` | `'line' \| 'ast'`    | `'line'`  | How `TaskRunner` splits files before sending to the LLM. `'ast'` falls back to line chunking (not yet implemented). |
| `telemetry.enabled` | `boolean`            | `true`    | Controls whether telemetry events are reported.                                                                     |

### Fallback behaviour

If `~/.docuvia/local.db` does not exist or cannot be read, Docuvia logs the absence and continues with all defaults applied (i.e., no `server_url`, `line` chunking, telemetry enabled).

---

## Credential Management

Docuvia stores a per-machine server authentication token using VS Code's `SecretStorage` API (OS keychain / credential store). Credentials are **never** written to disk in plaintext and are not part of VS Code workspace or global settings.

### Token Commands

| Command ID                 | Title                         | Behaviour                                                                                                                                    |
| -------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `docuvia.setServerToken`   | `Docuvia: Set Server Token`   | Opens a password-masked input box. On confirmation, stores the token under the key `docuvia.serverToken` via `CredentialManager.setToken()`. |
| `docuvia.clearServerToken` | `Docuvia: Clear Server Token` | Deletes the stored token via `CredentialManager.clearToken()`. Shows a confirmation toast.                                                   |

### Transport

The stored token is sent as the `x-docuvia-token` request header on all `POST /query` calls made by `CentralServerClient`. A `401` response from the server throws a `CentralServerAuthError`, which is caught in `executeSearch` to surface the error as a VS Code notification prompting the user to run `docuvia.setServerToken`.
