# Strict Local-First Evaluation & Missing Capabilities Index

**Self-Evaluation Score: 3 / 10 (Disjointed Pipeline, Pseudo-Local Architecture)**
**Date: 2026-06-27**

After a rigorous comparative analysis against top-tier local-first tools within the workspace (`code-review-graph`, `GitNexus`, `headroom`, `tolaria`), Docuvia currently fails to deliver a true end-to-end local experience. While the "VCS-based Knowledge Evolver" vision is established and the CLI structure is scaffolded, the data pipelines and execution modes are disjointed.

To elevate Docuvia to an 8-9/10 score, the monolithic evaluation has been atomized into highly specific, actionable implementation targets.

## Evaluation Registry

| ID     | Domain                                                | Target Component                   | Description                                                                                                                  |
| :----- | :---------------------------------------------------- | :--------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| **01** | [Local MCP](./01-local-mcp-stdio-server.md)           | `@workspace/cli`                   | Extract MCP tools from Express. Implement `stdio` server for 0-config Cursor/Claude integration.                             |
| **02** | [Agent Config](./02-agent-hook-mcp-registration.md)   | `@workspace/cli` (`init-agent`)    | Automate injection of the local `stdio` MCP server into `claude_desktop_config.json` and `.cursor/mcp.json`.                 |
| **03** | [Data Pipeline](./03-local-ast-extraction-sync.md)    | `@workspace/cli` (`sync`)          | Connect `sync local` to `@workspace/ast-core` to actually extract AST deltas from commits.                                   |
| **04** | [Local Storage](./04-local-sqlite-write-pipeline.md)  | `@workspace/cli` (`sync`)          | Implement the `INSERT INTO` logic to persist extracted L2/L3 AST nodes into `.docuvia/local.db`.                             |
| **05** | [Parsing Perf](./05-native-parsing-fallback.md)       | `@workspace/ast-core`              | Introduce Native C++ (`tree-sitter`) bindings with a graceful fallback to WASM to eliminate local OOMs and CPU spikes.       |
| **06** | [Worker Mgmt](./06-worker-pool-concurrency.md)        | `@workspace/ast-core`              | Implement a robust `worker_threads` pool with memory limits for concurrent local parsing.                                    |
| **07** | [Token Opt](./07-local-bfs-blast-radius.md)           | `@workspace/cli` (`query`)         | Replace naive `LIKE` queries with a local Graph BFS (Breadth-First Search) across `node_links` to isolate true blast radius. |
| **08** | [AST Precision](./08-ast-dependency-edge-creation.md) | `@workspace/ast-core`              | Enhance AST parsing to explicitly detect cross-file imports/calls and create `node_links` edges in SQLite.                   |
| **09** | [Local UI](./09-local-html-visualization.md)          | `@workspace/cli` (`visualize`)     | Implement a CLI command that generates a standalone, interactive D3.js/Mermaid HTML file of the local graph.                 |
| **10** | [IDE UI](./10-vscode-webview-topology.md)             | `@workspace/vscode-client`         | Embed the interactive graph visualization directly into a VS Code Webview panel (no React dev server required).              |
| **11** | [Realtime UX](./11-sub-second-save-updates.md)        | `@workspace/vscode-client`         | Hook into `onDidSaveTextDocument` to trigger sub-second, single-file AST delta updates without waiting for git commits.      |
| **12** | [Diff Opt](./12-file-hash-delta-detection.md)         | `@workspace/vscode-client` / `cli` | Implement file-hash tracking to bypass AST parsing for unchanged files during local incremental updates.                     |
