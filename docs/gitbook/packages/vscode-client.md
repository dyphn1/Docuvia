# VS Code Client (`docuvia-vscode`)

## What it is

The in-editor extension: a Knowledge Graph tree view, a Task Queue view, 21 commands, a `@docuvia` Copilot Chat participant, and CodeLens/Hover providers. For per-feature design docs (command flows, chat commands, UI/UX guidelines — 17 pages), see [Development → VS Code Client](../development/vscode-client/00-router-overview.md). This page is the package-level overview one level above those.

|             |                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Package     | `docuvia-vscode`                                                                                                                    |
| Entry point | `artifacts/vscode-client/src/extension.ts`                                                                                          |
| Manifest    | `package.json` — 1 view container, 2 views, 21 commands, 1 chat participant (4 subcommands: explore/query/extract/help), 4 settings |

> **Current architecture note:** the [ADR-021](../adr/ADR-021-shared-core-api-and-presentation-layers.md) refactor is **already complete in code**. The legacy `KnowledgeStore` / `TaskRunner` / `CentralServerClient` classes described throughout `docs/gitbook/development/vscode-client/*.md` (via their DEPRECATION NOTICE banners) no longer exist in `src/`. Commands and providers now call `@workspace/core` services directly (e.g. `AnalyzeService`, `LocalSnapshotService`) — the same services the [CLI](cli.md) wraps. Those per-feature docs describe the target state and are still pending a rewrite; treat this page and the actual source as current truth in the meantime.

## Activation Flow

`activate()` wires up 7 subsystems in order:

1. Output channel (logging)
2. Global config, loaded from `~/.docuvia/config.yaml`
3. `CredentialManager` — wraps the VS Code Secrets API for token storage
4. Tree providers — `KnowledgeGraphTreeProvider`, `TaskQueueTreeProvider`
5. `registerProviders()` — CodeLens + Hover
6. `registerDocuviaChatParticipant()` — the `@docuvia` chat participant
7. `registerCommands()` — all 21 commands

## Structure

```
src/
  extension.ts                    — activation entry point
  types.ts, parser.ts             — shared types, config YAML parsing
  commands/                       — 8 files: explore, init-project, extraction,
                                     decision, dashboard, search, graph, tags,
                                     tasks, workspace, auth
  chat-participant.ts + chat/     — @docuvia registration + ontology + 4 handlers
                                     (explore, extract, query, help)
  providers/                      — CodeLens & Hover registration
  knowledge-graph-tree-provider.ts, task-queue-tree-provider.ts
  docuvia-code-lens-provider.ts, docuvia-hover-provider.ts
  dashboard-panel.ts, search-results-panel.ts   — webviews
  webview/                        — dashboard HTML template, message contract, types
  credential-manager.ts           — VS Code secrets wrapper
```

## See also

- [Development → VS Code Client Design Overview](../development/vscode-client/00-router-overview.md) — the 17-page detail tree (command palette flows, chat participant, knowledge graph views, UI/UX guidelines).
- [CLI](cli.md) — shares the same `@workspace/core` services for local-first operations.
- [ADR-021](../adr/ADR-021-shared-core-api-and-presentation-layers.md) — the architectural decision this package now fully implements.
