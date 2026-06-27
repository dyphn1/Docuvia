# Implementation Plan: Shared Core API (Hexagonal Architecture)

## Implementation Goals

1. Establish `@workspace/core` in `lib/core/` to act as the single source of truth for Docuvia's local-first business logic (Query, Init, Analyze, Extract).
2. Refactor `artifacts/cli/src/commands/query.ts` so it no longer manually duplicates Drizzle SQLite schemas, but instead imports `QueryService` from `@workspace/core` (which strictly depends on `lib/db/src/schema`).
3. Expand CLI commands to include `docuvia init`, `docuvia analyze`, and `docuvia extract` using the new Core API.
4. Align the MCP Server (`artifacts/cli/src/mcp/server.ts`) by registering the missing tools (`docuvia_init`, `docuvia_analyze`, `docuvia_extract`) and routing them to `@workspace/core`.
5. Align the VS Code Client (`artifacts/vscode-client`) by replacing its internal logic and command handlers (`docuvia.initProject`, `docuvia.startExplore`, `docuvia.addDecision`) with standardized calls to `@workspace/core`.

## Approach / Methodology

### Step 1: Scaffold `@workspace/core`

- Create `lib/core/package.json` with name `@workspace/core` and type `module`.
- Configure `tsconfig.json` for ESM build.
- Add `dependencies`: `@workspace/db`, `drizzle-orm`, `better-sqlite3`.

### Step 2: Implement Core Services

- [x] Create `lib/core/src/services/QueryService.ts` containing the SQLite querying logic (fixing the schema duplication issue by importing from `@workspace/db/src/schema`).
- [x] Create `lib/core/src/services/InitService.ts` to handle local SQLite DB initialization.
- [x] Create `lib/core/src/services/AnalyzeService.ts` to house AST analysis invocation.
- [x] Create `lib/core/src/services/ExtractService.ts` to manage L3 decision extractions.
- [x] Create `lib/core/src/index.ts` to export these services cleanly to presentation layers.

### Step 3: Refactor the CLI

- Add `@workspace/core` as a dependency in `artifacts/cli/package.json`.
- [x] Update `artifacts/cli/src/commands/query.ts` to instantiate and use `QueryService`.
- [x] Create `artifacts/cli/src/commands/init.ts` that wraps InitService.
- [x] Create `analyze.ts` and `extract.ts` that wrap the respective Core services.
- [x] Register these new commands in `artifacts/cli/src/cli.ts`.

### Step 4: Refactor the MCP Server

- [x] Add `@workspace/core` as a dependency in `artifacts/cli/package.json` (if not already added).
- [x] Edit `artifacts/cli/src/mcp/server.ts` to register `docuvia_init`, `docuvia_analyze`, and `docuvia_extract`.
- [x] Route the execution of these MCP tools to the methods provided by `@workspace/core`.

### Step 5: Refactor the VS Code Extension

- [x] Add `@workspace/core` as a dependency in `artifacts/vscode-client/package.json`.
- [x] Refactor `artifacts/vscode-client/src/extension.ts` (and `KnowledgeStore.ts` if applicable) to delegate DB init, analysis, and extraction tasks directly to `@workspace/core`.
- [x] Ensure feature parity: the VS Code commands must perform identical operations to the CLI and MCP.

## Affected Workspace Packages

- `lib/core` (New)
- `artifacts/cli`
- `artifacts/vscode-client`

## Verifiable Implementation Criteria

- [x] `artifacts/cli/src/commands/query.ts` contains ZERO `sqliteTable` definitions.
- [x] The CLI command `docuvia query <target>` successfully retrieves L2/L3 nodes using `@workspace/core`.
- [x] The MCP server exposes `docuvia_init`, `docuvia_analyze`, and `docuvia_extract` via `server.ts`.
- [x] The VS Code Client successfully initializes the project database relying entirely on `InitService` from `@workspace/core`.
