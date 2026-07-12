# CLI Commands

The `docuvia` Command Line Interface (CLI) is the primary tool for managing local knowledge graphs, analyzing ASTs, querying the knowledge base, and extracting architecture context. 

In Docuvia2, the CLI is built with a script-first philosophy. Commands execute non-interactively by default to prevent hanging in CI or AI workflows. You can opt-in to a guided **Wizard-Style Interactive Shell** by appending the `--interactive` flag.

## Available Commands

| Command | Description |
| :--- | :--- |
| **[`docuvia init`](cli/init.md)** | Initialize the local project, SQLite database, and configure platforms. |
| **[`docuvia analyze [path]`](cli/analyze.md)** | Analyze the project/file and construct the AST knowledge graph. |
| **[`docuvia snapshot`](cli/snapshot.md)** | Export the SQLite graph to a local git orphan branch. |
| **[`docuvia sync`](cli/sync.md)** | Sync local changes to the remote server. |
| **[`docuvia review`](cli/review.md)** | Detect structural changes and compute risk scores against a base branch. |
| **[`docuvia query <search_query>`](cli/query.md)** | Query the local knowledge graph via the terminal (FTS Keyword Search). |
| **[`docuvia impact <target>`](cli/impact.md)** | Compute blast radius and risk level for a symbol. |
| **[`docuvia status`](cli/status.md)** | Check the health and statistics of the local SQLite index database. |
| **[`docuvia clean`](cli/clean.md)** | Wipe the local knowledge graph database (`local.db`). |
| **[`docuvia export --topology`](cli/export.md)** | Export the knowledge graph as an offline interactive topology map. |
| **[`docuvia mcp`](cli/mcp.md)** | Start the local MCP stdio server for direct integration. |

> **Interactive Prompts (`--interactive`)**: All commands will fail-fast if required arguments are missing unless the `--interactive` flag is used, which provides a guided prompt experience.
>
> **Strict Repo-Scoped Boundaries**: Commands will never modify machine-global state (e.g., OS configurations). All actions and artifacts are strictly confined to your current workspace.
>
> **Structured logs**: Every one-shot command writes a JSONL run log to `.docuvia/logs/<command>.log` — one line per event (`.start`, `.summary`, `.error`) — useful for auditing headless AI agent runs.
