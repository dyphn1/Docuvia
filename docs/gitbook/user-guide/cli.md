# CLI Commands

The `docuvia` Command Line Interface (CLI) is the primary tool for managing local knowledge graphs, analyzing ASTs, querying the knowledge base, and interacting with Agentic RAG workflows.

Below is the complete reference for all available commands. Click on any command for detailed usage, parameters, and examples.

## Available Commands

| Command                                          | Description                                                              |
| :----------------------------------------------- | :----------------------------------------------------------------------- |
| **[`docuvia init`](cli/init.md)**                | Initialize the local project, index database, and install agent hooks.   |
| **[`docuvia analyze [path]`](cli/analyze.md)**   | Analyze the project/file and construct the AST knowledge graph.          |
| **[`docuvia snapshot`](cli/snapshot.md)**        | Pack the local knowledge graph to a local orphan branch.                 |
| **[`docuvia sync`](cli/sync.md)**                | Sync local changes to the remote server.                                 |
| **[`docuvia review`](cli/review.md)**            | Detect structural changes and compute risk scores against a base branch. |
| **[`docuvia query`](cli/query.md)**              | Query the local knowledge graph via the terminal.                        |
| **[`docuvia status`](cli/status.md)**            | Check the health and statistics of the local index database.             |
| **[`docuvia clean`](cli/clean.md)**              | Wipe the local knowledge graph database (`local.db`).                    |
| **[`docuvia export --topology`](cli/export.md)** | Export the knowledge graph as an offline interactive topology map.       |
| **[`docuvia mcp`](cli/mcp.md)**                  | Start the local MCP stdio server for direct integration.                 |
