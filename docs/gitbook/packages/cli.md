# CLI (`@workspace/cli`)

## What it is

`docuvia` is a thin command dispatcher. There is no commander/yargs framework — `src/cli.ts` reads `process.argv[2]` directly and branches on the command name. Every command handler is a one-line wrapper that instantiates a service class from `@workspace/core` and calls it; the CLI itself holds no business logic (same "presentation layer over `@workspace/core`" pattern as [vscode-client](vscode-client.md), per [ADR-021](../adr/ADR-021-shared-core-api-and-presentation-layers.md)).

|                  |                                   |
| ---------------- | --------------------------------- |
| Package          | `@workspace/cli`                  |
| Bin              | `docuvia` → `./src/cli.ts`        |
| Entry point      | `artifacts/cli/src/cli.ts`        |
| Command handlers | `artifacts/cli/src/commands/*.ts` |

## Command Reference

| Command                               | Flags                               | Description                                                                                                                                                                                                             |
| ------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docuvia init`                        | —                                   | Initialize the local project: creates `.docuvia/local.db` (SQLite) and installs MCP server config + hooks for AI coding assistants (Claude Code, Cursor, Copilot).                                                      |
| `docuvia analyze [path]`              | `--deep`                            | Scan the workspace for file types and project tags. With `--deep`, also triggers background L3 decision extraction. If a `[path]` is provided, scopes the extraction to a specific file or directory.                   |
| `docuvia status`                      | —                                   | Report local index health — project count, L2 node count, L3 decision count.                                                                                                                                            |
| `docuvia clean`                       | —                                   | Wipe the local `.docuvia/local.db` knowledge graph database.                                                                                                                                                            |
| `docuvia review`                      | `--baseRef=<ref>`                   | Detect structural changes and a risk score against a git ref (default: working tree diff).                                                                                                                              |
| `docuvia sync [<project_id>] [<sha>]` | —                                   | Sync local AST changes to the remote API server over HTTP.                                                                                                                                                              |
| `docuvia snapshot`                    | —                                   | Pack knowledge straight into the `docuvia-knowledge` orphan branch — no server needed.                                                                                                                                  |
| `docuvia query <target>`              | `--local`, `--format=human\|prompt` | Query the local knowledge graph for L2/L3 context on a symbol or file. `--format=prompt` wraps the result in an `<docuvia_context>` XML block for direct LLM prompt injection; default is human-readable (ANSI colors). |
| `docuvia export --topology`           | `--json`, `--out=DIR`, `--collapse` | Export the knowledge graph into `topology.json` and a fully self-contained offline `topology.html` interactive viewer.                                                                                                  |
| `docuvia mcp`                         | —                                   | Start the local MCP server over stdio (long-running; used by Claude Desktop / Cursor as a subprocess, not exited like the other commands).                                                                              |

Running `docuvia` with no recognized command prints the same reference list as a fallback usage message (hardcoded in `cli.ts`, not auto-generated — there is no `--help` flag or snapshot test today).

## Call Chains

**`docuvia init`**

```
cli.ts → InitService.init()  (@workspace/core)
  → git: create the docuvia-knowledge orphan branch (hash-object / commit-tree)
  → write .git/hooks/post-commit
  → write .docuvia/config.json
  → create .docuvia/local.db (better-sqlite3)
```

**`docuvia analyze [--deep]`**

```
cli.ts → AnalyzeService.analyzeProject({ deep })  (@workspace/core)
  → VcsScannerService.extractHotspotTags()      — git log analysis
  → ConfigScannerService.scanConfigs()          — detect project type from package.json etc.
  → FileDiscoveryService.discoverFiles()        — walk workspace, respect .gitignore
  → AstProcessingService.processFiles()         — worker-pool parse via web-tree-sitter WASM
  → SqliteGraphRepository.persistAstGraph()     — write L2 nodes to .docuvia/local.db
  → [if --deep] L3ExtractionJobService.triggerBackgroundExtraction()
```

**`docuvia query <target> [--local] [--format]`**

```
cli.ts → QueryService.query(target, options)  (@workspace/core)
  → SELECT from .docuvia/local.db: l2_nodes, l3_nodes, node_links
  → [optional] LspEnrichmentService — escalate to the TypeScript compiler for precise refs
  → format: human (ANSI) or prompt (XML for LLM injection, formatPromptOutput() in query.ts)
```

**`docuvia sync <project_id> [<sha>]`**

```
cli.ts → syncCommand()  (imports SyncService from @workspace/core)
  → SyncService.sync()  — HTTP POST to DOCUVIA_API_URL, authenticated with MCP_PAT
```

**`docuvia snapshot`**

```
cli.ts → snapshotCommand()
  → SnapshotService.snapshot()
  → writeKnowledgeToOrphanBranch() — commit to docuvia-knowledge
```

**`docuvia export --topology [--json] [--out=DIR] [--collapse=auto|file|symbol]`**

```
cli.ts → exportTopologyCommand(options)
  → TopologyExportService.exportTopology({ collapse }) (@workspace/core)
  → write topology.json
  → [if not --json] write topology.html via renderTopologyHtml() inline canvas template
```

## Architecture Alignment

The CLI is where several ADRs become directly observable in day-to-day usage:

- **[ADR-002](../adr/ADR-002-local-first-architecture.md) (Local-First)** — `query` and `analyze` never require a server; they read/write `.docuvia/local.db` directly.
- **[ADR-014](../adr/ADR-014-sql-indexed-graph-and-database-as-ipc.md) (Database-as-IPC)** — all state changes go through SQLite, never in-process objects.
- **[ADR-017](../adr/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md) (Orphan Branch)** — `docuvia snapshot` writes to the `docuvia-knowledge` branch instead of the server.
- **[ADR-020](../adr/ADR-020-unified-isomorphic-ast-microkernel.md) (AST Microkernel)** — `analyze`/`extract` parse via the same WASM `web-tree-sitter` engine used by the VS Code extension, running in isolated `worker_threads`.
- **[ADR-023](../adr/ADR-023-granular-markdown-storage.md) (Granular Markdown Storage)** — AST deltas synced locally are written as JSONL/Markdown, not one giant blob.
- **[ADR-021](../adr/ADR-021-shared-core-api-and-presentation-layers.md) (Shared Core API)** — every command is a thin wrapper around a `@workspace/core` service; the same services back `docuvia mcp` and the VS Code extension.

`docuvia mcp` exposes roughly the same capabilities as MCP tools (`docuvia_context`, `docuvia_impact`, `docuvia_query`, …) for AI IDEs — `init-agent` is what wires this server into Claude Code / Cursor / Copilot automatically.
