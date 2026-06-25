# Verification Report: VS Code Store Sync (Data Loss & Obsolete Watchers)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 8 - KnowledgeStore Reactivity & SyncOutbox
- **Target File**: artifacts/vscode-client/src/KnowledgeStore.ts, artifacts/vscode-client/src/CentralServerClient.ts
- **Status Update Required**: ❌ ERROR

### Description of Failure
1. **Database-as-IPC Violation (`KnowledgeStore.ts`):** The client is not using SQLite IPC. It actively violates ADR-014 by creating a file watcher on the raw YAML files: `vscode.workspace.createFileSystemWatcher(pattern)` for `.docuvia/**`. During load, it attempts a server fetch, then falls back to manually reading and parsing `l1_tags.yaml` from the filesystem instead of querying the SQLite DB.
2. **Critical Data Loss / No Offline Durability (`CentralServerClient.ts`):** The outbox mechanism is not correctly implemented to handle offline states; it will drop data if the network fails. The `sync()` method executes a one-shot HTTP `fetch()` to `/sync/push`. There is no local durable queue (no SQLite). If the `fetch` fails, it throws an Error and the sync event payload is lost into the void.

### Recommended Fix
Remove all `vscode.FileSystemWatcher` logic from `KnowledgeStore.ts` and replace it with direct SQLite queries and IPC listeners. Implement a local SQLite `sync_outbox` table in `CentralServerClient.ts` where actions are durably queued before being transmitted.
