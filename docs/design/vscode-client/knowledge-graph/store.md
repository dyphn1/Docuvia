> **DEPRECATION NOTICE**: This document describes legacy client-side implementations (`KnowledgeStore`, `TaskRunner`, `CentralServerClient`). Per [ADR-021](../../adrs/ADR-021-shared-core-api-and-presentation-layers.md), these responsibilities have moved to the Shared Core API (`@workspace/core`). This document is pending a rewrite.

> **DEPRECATION NOTICE**: This document describes legacy client-side implementations (`KnowledgeStore`, `TaskRunner`, `CentralServerClient`). Per [ADR-021](../../adrs/ADR-021-shared-core-api-and-presentation-layers.md), these responsibilities have moved to the Shared Core API (`@workspace/core`). This document is pending a rewrite.

# Core Concepts: State Management via Shared Core API

_(Note: Legacy implementations like `KnowledgeStore` and `CentralServerClient` inside `vscode-client` are deprecated. As per ADR-021, all state management, SQLite logic, and synchronization now reside in `@workspace/core`.)_

## Database-as-IPC Architecture

The VS Code Client no longer manages its own SQLite connections or in-memory models. Instead, it delegates to `@workspace/core` (specifically `sqlite-graph.repository.ts` and related services) to interact with the [Local-First Architecture](../../adrs/ADR-002-local-first-architecture.md) via [Database-as-IPC](../../adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md).

## Multi-Root Workspace Support

The Core API dynamically maps `workspaceRoot` paths to their respective Project IDs within the local SQLite database. The VS Code extension simply passes `workspaceUri` strings to Core functions.

## Key Operations (Delegated to Core)

- **Initialization**: The extension host initializes the Core dependency injection container. The Core API queries the local SQLite database to retrieve the structured [L1/L2/L3 abstraction tiers](../../adrs/ADR-005-knowledge-abstraction-strategy.md).
- **Background Watchers**: The Core API spawns and manages the [AST Microkernel](../../adrs/ADR-020-unified-isomorphic-ast-microkernel.md).
  - **Reactivity**: The VS Code Client subscribes to IPC control signals from the Core API indicating that the SQLite graph has been updated.
  - **Background Debouncing**: Handled natively by the Core API [Asynchronous Metabolism](../../adrs/ADR-008-asynchronous-metabolism.md).
  - **Git Checkout Defense**: The Core API handles [Git Blob Native Identity](../../adrs/ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md).
- **Enrichment**: Core API resolves URIs returning contextual snapshots for CodeLens/Hover (via [Progressive Enrichment](../../adrs/ADR-015-progressive-enrichment-and-ast-lsp-dual-engine.md)).

## Offline Writes (CQRS Outbox)

When the user triggers a command (e.g., adding a decision), the extension calls the Core API:

1. The Core API writes the change directly into the local SQLite database.
2. The change is inserted into a `SyncOutbox` table (managed by `sync-service.ts`).
3. Core API handles pushing changes to the API Server and maintaining the [Git-Isomorphic Graph](../../adrs/ADR-004-git-isomorphic-graph.md).

---

## Lifecycle / Disposal

The VS Code extension manages the lifecycle of the Core instance:

- **Activation**: Initializes the Core API container.
- **`dispose()`**: Safely calls the Core API disposal methods to close SQLite connections and terminate background workers.
