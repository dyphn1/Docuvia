# VS Code Client Refactoring Report

## Observations

According to `ADR-021` and `docs/architecture/system-architecture-refactoring.md`, the VS Code extension (`vscode-client`) should act strictly as a presentation layer. It should select and compose `@workspace/core` for all local SQLite state, background processing (AST workers), and network synchronization.

However, the current implementation in `artifacts/vscode-client/src/` contains multiple violations of this architecture:

1. **`CentralServerClient` (`central-server-client.ts`)**:
   - Manages HTTP REST API calls to the central server.
   - **Action Required**: Must be removed. The VS Code extension should delegate remote synchronization and query execution to `SyncService` and `IntentRouter` from `@workspace/core`.

2. **`KnowledgeStore` (`knowledge-store.ts`)**:
   - Manages local SQLite connection and `SyncOutbox`.
   - Directly spawns and manages the AST Microkernel worker (`AstWatcher`).
   - Implements CQRS Outbox pattern locally.
   - **Action Required**: Must be removed or reduced to a very thin adapter. Core DB logic should be delegated to `SqliteGraphRepository`, and worker management to the `AstIngestionPipeline` / `AstWorkerPool` inside `@workspace/core`.

3. **`AstWatcher` (`indexer/ast-watcher.ts`)**:
   - Represents the background AST compilation and file watching logic.
   - **Action Required**: Should be replaced by listening to events emitted by the `@workspace/core` asynchronous metabolism engine.

4. **`TaskRunner` (`task-runner.ts`)**:
   - Re-implements token management and extraction orchestration.
   - **Action Required**: Should delegate to `@workspace/core` orchestration services (`ExtractService`).

## Next Steps

To align with the **"Core-Driven Development"** principle:
1. Initialize the `@workspace/core` DI container inside `extension.ts`.
2. Rewrite VS Code Commands and Providers to invoke Core API interfaces.
3. Remove `CentralServerClient`, `KnowledgeStore` (db parts), and `AstWatcher` from the extension.
