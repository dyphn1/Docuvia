# Core Concepts: State Management via Shared Core API

Per [ADR-021](../../../adr/ADR-021-shared-core-api-and-presentation-layers.md), `vscode-client` no longer has a `KnowledgeStore` singleton, `TaskRunner`, or `CentralServerClient` class — this refactor is complete in the current codebase.

## What actually replaced `KnowledgeStore`

There is no shared state container or dependency-injection object. Each command/provider constructs the `@workspace/core` class it needs, directly, per call:

| Component                                            | What it calls                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `KnowledgeGraphTreeProvider` (tree view)             | `new LocalSnapshotService(workspaceRoot).getSnapshot()` per node expansion — see [Tree Nodes](nodes.md)             |
| `docuvia.initProject`                                | `new InitService(workspaceRoot).init()` — see [Init Project](../command-palette/init-project.md)                    |
| `docuvia.addDecision` / `runExtraction` / `/extract` | `new ExtractService(workspaceRoot).extractDecisions()` — see [Run Extraction](../command-palette/run-extraction.md) |
| `docuvia.openSearch` / `/query`                      | `QueryService` — see [Search](../command-palette/search.md)                                                         |
| "Save as Decision Record" button, `docuvia.sync`     | `openLocalDatabase(workspaceRoot)` for direct `better-sqlite3` access                                               |

There is no in-memory cache layer in the extension — every read re-queries `.docuvia/local.db` through one of these services. This mirrors the [CLI](../../../packages/cli.md), which calls the same `@workspace/core` services directly rather than through the extension.

## Reactivity

The tree view refreshes via a `vscode.workspace.createFileSystemWatcher` on `.docuvia/local.db` (change/create/delete → `refresh()` → `onDidChangeTreeData`) — see [Tree Nodes: Data Management & Sync](nodes.md#data-management--sync) for the full mechanism, including a known dead-refresh-command bug in several call sites.

## Offline / Sync

Sync to the API server (`docuvia sync`, credential-gated — see [Settings: Credential Management](../configuration/settings.md#credential-management)) and to the `docuvia-knowledge` orphan branch happens through `@workspace/core`'s `SyncService`, the same one the [CLI's `sync` command](../../../packages/cli.md#call-chains) uses. There is no client-side outbox queue or background sync worker inside `vscode-client` itself — sync is triggered explicitly by running the command.

## Lifecycle

- **Activation**: `extension.ts`'s `activate()` constructs the tree providers, `CredentialManager`, and registers commands/providers/chat participant — see [Package Overview](../../../packages/vscode-client.md#activation-flow) for the full list.
- There is no explicit Core "container" to dispose — each service instance is short-lived (constructed, used, and garbage-collected per command invocation) rather than held for the extension's lifetime.
