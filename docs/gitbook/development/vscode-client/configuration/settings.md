# Docuvia Configuration Settings

Defined in `artifacts/vscode-client/package.json` -> `contributes.configuration`.

## Settings List

### `docuvia.search.defaultView`

- **Type**: `string`
- **Default**: `"chat"`
- **Enum**: `["chat", "webview"]`
- **Description**: Where to display cross-project search results by default (governed by [Local-First Architecture](../../../adr/ADR-002-local-first-architecture.md) and [Agentic RAG Routing](../../../adr/ADR-007-agentic-rag-routing.md)). If set to `chat`, it pre-fills GitHub Copilot Chat with `@docuvia /query <text>`. If set to anything other than `chat`, the current implementation shows a fallback message pointing the user at chat — the `webview` result view is not implemented yet (see [Search](../command-palette/search.md)).

### `docuvia.extraction.includePatterns`

- **Type**: `array` of `string`
- **Default**: `["**/*.ts", "**/*.js", "**/*.tsx", "**/*.jsx", "**/*.py", "**/*.rs", "**/*.go", "**/*.java", "**/package.json", "**/pyproject.toml"]`
- **Description**: Glob patterns for files that should be analyzed automatically when triggering "Run Extraction" via the [AST Microkernel](../../../adr/ADR-020-unified-isomorphic-ast-microkernel.md). Evaluated using `minimatch`. Files not matching this list will trigger a confirmation prompt before extraction to respect [Token Management](../../../adr/ADR-009-token-management.md) boundaries.

### `docuvia.extraction.maxLinesWarning`

- **Type**: `number`
- **Default**: `1000`
- **Description**: Show a warning before extracting files larger than this many lines. Encourages the user to use "Add Decision from Selection" for large files instead of sending the entire file to the LLM, triggering [Context Compression](../../../adr/ADR-010-context-compression-and-proxy.md).

### `docuvia.extraction.maxFileSizeKBWarning`

- **Type**: `number`
- **Default**: `50`
- **Description**: Show a warning before extracting files larger than this size in KB. Acts as a second layer of token-consumption protection ([Token Management](../../../adr/ADR-009-token-management.md)) alongside line count limits.

### `docuvia.knowledgeGraph.incrementalUpdateThreshold`

- **Type**: `number`
- **Default**: `50`
- **Description**: Maximum number of files modified in a batch before forcing a full Knowledge Graph reload instead of an incremental update.

### `docuvia.knowledgeGraph.incrementalUpdateRatioThreshold`

- **Type**: `number`
- **Default**: `0.5`
- **Description**: Maximum ratio (0.0 to 1.0) of modified files relative to total `.docuvia` files before forcing a full Knowledge Graph reload.

All six settings above are present in `package.json`'s `contributes.configuration` and are discoverable/editable via the VS Code Settings UI — the discrepancy noted in earlier drafts of this doc is resolved.

---

## Global Config (`~/.docuvia/config.yaml`)

In addition to VS Code workspace settings, Docuvia reads a **global user-level YAML config file** at activation time. This file applies across all workspaces on the machine.

- **Path**: `~/.docuvia/config.yaml` (resolved via `os.homedir()`, see `extension.ts`)
- **Read at**: Extension activation, via `parseGlobalConfig()` (`parser.ts`)
- **Parsed into**: `GlobalConfig` (Zod-validated by `GlobalConfigSchema` in `types.ts`) — no longer routed through `KnowledgeStore`/`TaskRunner`, which no longer exist.

### Schema (`GlobalConfigSchema`, `types.ts`)

| Field               | Type                 | Default   | Description                                                                                                                 |
| ------------------- | -------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `server_url`        | `string` (HTTPS URL) | _(unset)_ | URL of the central Docuvia server. Must use `https://`.                                                                     |
| `chunking_strategy` | `'line' \| 'ast'`    | `'line'`  | How extraction splits files before sending to the LLM. `'ast'` currently falls back to line chunking (not yet implemented). |
| `telemetry.enabled` | `boolean`            | `true`    | Controls whether telemetry events are reported.                                                                             |

### Fallback behaviour

If `~/.docuvia/config.yaml` does not exist or fails schema validation, `parseGlobalConfig()` logs the error and returns `GlobalConfigSchema.parse({})` — i.e. all defaults applied (no `server_url`, `line` chunking, telemetry enabled).

---

## Credential Management

Docuvia stores a per-machine server authentication token using VS Code's `SecretStorage` API (OS keychain / credential store), via `CredentialManager` (`credential-manager.ts`). Credentials are **never** written to disk in plaintext and are not part of VS Code workspace or global settings.

### Token Commands

| Command ID                 | Title                         | Behaviour                                                                                                                                           |
| -------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docuvia.setServerToken`   | `Docuvia: Set Server Token`   | Opens a password-masked input box. On confirmation, stores the token under the secret key `docuvia.serverToken` via `CredentialManager.setToken()`. |
| `docuvia.clearServerToken` | `Docuvia: Clear Server Token` | Deletes the stored token via `CredentialManager.clearToken()`. Shows a confirmation toast.                                                          |

### Usage

The stored token is currently read by the `docuvia.sync` command (`commands/workspace.ts`, `syncCommand()`) — if no token is set, sync fails immediately with an error message rather than attempting an unauthenticated request. There is no longer a `CentralServerClient` or `CentralServerAuthError`; the actual HTTP transport for sync lives in `@workspace/core`'s `SyncService`, mirroring the CLI's [`docuvia sync`](../../../packages/cli.md#call-chains) command.
