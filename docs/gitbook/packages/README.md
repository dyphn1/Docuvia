# Packages

Docuvia is a pnpm monorepo. This section introduces the five artifact packages under `artifacts/` — what each one is, how it's structured, and how it fits together with the rest of the system.

| Package                     | Type                      | Main Tech                             | Overview                                                                   |
| --------------------------- | ------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| `@workspace/cli`            | Command-line tool         | Node.js, `@workspace/core`            | [CLI](cli.md) — full command reference + call chains                       |
| `@workspace/api-server`     | REST + MCP server         | Express, Drizzle, PostgreSQL, Pino    | [API Server](api-server.md) — route groups, OpenAPI contract               |
| `@workspace/kg-engine`      | Web dashboard             | React, Vite, TanStack Query, Radix UI | [KG Engine](kg-engine.md) — page map                                       |
| `@workspace/mockup-sandbox` | Component preview sandbox | React, Vite, Chokidar                 | [Mockup Sandbox](mockup-sandbox.md) — auto-discovery mechanism             |
| `docuvia-vscode`            | VS Code extension         | TypeScript, VS Code API               | [VS Code Client](vscode-client.md) — activation flow, current architecture |

All five presentation layers (CLI, API server, VS Code extension) compose the same shared `@workspace/core` / `lib/db` services rather than duplicating business logic — see [ADR-021](../adr/ADR-021-shared-core-api-and-presentation-layers.md) and [Building Blocks](../architecture/building-blocks.md).
