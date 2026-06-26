# Verification Report: docuvia sync Bidirectional CLI

- **Date**: 2026-06-26
- **Phase & Item**: Phase 8 — `docuvia sync` Bidirectional CLI
- **Target File**: `artifacts/vscode-client/src/CentralServerClient.ts`, `artifacts/api-server/src/routes/sync.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure

The `docuvia sync` feature is **half-implemented**: the server-side sync endpoint exists and is functional, but the VS Code client-side `docuvia sync` command is completely missing. Specifically:

1. **No `docuvia.sync` command registered in VS Code extension** — The `package.json` contributions list 17 commands (`docuvia.startExplore`, `docuvia.initProject`, `docuvia.addDecision`, etc.) but there is NO `docuvia.sync` command. Users have no way to trigger a sync from the IDE.

2. **`CentralServerClient.sync()` is dead code** — The `sync(projectId, branch, commits)` method at line 99 of `CentralServerClient.ts` is fully implemented (builds CQRS outbox events, sends `POST /sync/push` with auth token), but it is **never called** from anywhere in the codebase. Zero call sites outside its own definition.

3. **Auth gap on `/sync/push`** — The sync router is mounted in `routes/index.ts` at line 54 via `router.use(syncRouter)` with NO `requireApiKey` middleware. The `POST /sync/push` endpoint accepts arbitrary CQRS events from unauthenticated clients — anyone can write L3 nodes to any project's knowledge graph by sending a JSON body with a `projectId`. The `SyncPushBody` Zod schema validates structure only (number + array), with no ownership check.

4. **Pull works, push doesn't** — `pullSnapshot()` IS wired: called from `KnowledgeStore.ts:162`. The one-directional pull (server → client) is functional, but bidirectional sync (client → server) requires the push path which has no caller.

### Recommended Fix

1. **Register the `docuvia.sync` command** in `extension.ts` — Create a command handler that:
   - Gets the current project ID from workspace config
   - Detects git branch and recent commits (via `simple-git` or VS Code's git extension)
   - Calls `centralServer.sync(projectId, branch, commits)`
   - Shows progress notification

2. **Add `requireApiKey` to `/sync/push`** — In `routes/index.ts`, change:
   ```typescript
   router.use(syncRouter);
   ```
   to:
   ```typescript
   router.use(requireApiKey, syncRouter);
   ```
   This aligns with sibling routers (`ingest`, `documents`, `metabolism`) that all use `requireApiKey`.

3. **Add project-level ownership check** — The sync endpoint accepts any `projectId`. After auth, verify the authenticated user owns the project before applying CQRS events. Without this, any authenticated user can modify any project's knowledge graph.

4. **Wire `CentralServerClient.sync()` to a trigger** — Options:
   - Called from the new `docuvia.sync` command (manual trigger)
   - Called automatically on VS Code startup or periodically (auto-sync)
   - Called from a git post-commit hook integration

---

## Design Spec References

| Document | Section | Description |
|----------|---------|-------------|
| ADR-008-asynchronous-metabolism.md | CQRS Outbox | Sync push implements CQRS outbox pattern for knowledge mutations |
| ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md | Git Sync | Underlying `writeKnowledgeToOrphanBranch` writes knowledge to orphan branch |

---

## Source Files Examined

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/routes/sync.ts` | Server-side sync endpoint (POST /sync/push) |
| `artifacts/api-server/src/routes/index.ts` | Router mounting (line 54: syncRouter without auth) |
| `artifacts/vscode-client/src/CentralServerClient.ts` | Client SDK — `sync()` method (dead code) |
| `artifacts/vscode-client/src/extension.ts` | VS Code command registration (no sync command) |
| `artifacts/vscode-client/package.json` | Contribution points — 17 commands, no sync |
| `lib/api-zod/src/generated/api.ts` | SyncPushBody schema definition |

**Checksums (SHA-256):**

| File | Hash |
|------|------|
| `artifacts/api-server/src/routes/sync.ts` | `39a4cfd54f249bc3caecd5ff7df00122787b1d666c204ae69cc3617f7d9e8326` |
| `artifacts/vscode-client/src/CentralServerClient.ts` | `bbe4c93e837b67bece90d6ef398f19894190e8bf5991ab81b31a63739451cb5c` |

---

## Round 1 — Architecture & Design Review

### Design ↔ Implementation Alignment

**✅ Correctly implemented:**

1. **Server-side sync endpoint** — `POST /sync/push` correctly implements CQRS outbox pattern: acquires PG advisory lock per project, wraps operations in a transaction, writes knowledge to orphan branch after DB commit.
2. **`pullSnapshot()` wiring** — The pull direction (server → client) is correctly wired in `KnowledgeStore.ts:162`, hit on knowledge graph refresh.
3. **`SyncPushBody` Zod schema** — Structure validation is correct: requires `projectId` (number) and `events` (array of `{type, payload}`).
4. **CentralServerClient.sync() method** — Implementation is correct: builds proper outbox events, sends with auth token, handles 401.

### Gaps / Deviations

1. **❌ No client-side sync command** — The "Bidirectional CLI" feature implies a user-facing command. Zero registration in `package.json` or `extension.ts`.
2. **❌ Dead code: `CentralServerClient.sync()`** — Fully implemented but never called. The push path is completely unwired.
3. **⚠️ Incomplete bidirectionality** — Only pull works. A "bidirectional CLI" that can only pull is half a feature.

---

## Round 2 — Code Quality & Security Review

### Strengths

1. **Server-side transaction safety** — Advisory lock + DB transaction ensures concurrent sync requests don't corrupt data.
2. **Auth token in client** — `CentralServerClient.sync()` correctly reads token from `CredentialManager` and sends as `x-docuvia-token` header.
3. **Error handling** — 401 → `CentralServerAuthError`, non-2xx → generic error with status code.

### Issues Found

1. **🔴 Missing `requireApiKey` on `/sync/push`** — Any unauthenticated client can POST CQRS events to modify any project's knowledge graph. This is a direct data integrity vulnerability.
2. **🔴 No project ownership check** — Even after auth, there's no verification that the authenticated user owns the `projectId` they're sending events for. Combined with missing auth = any authenticated user can write to any project.
3. **⚠️ Dead import/method** — `sync()` was implemented but never wired. This suggests a prior session hit the tool-call limit before completing integration.

---

## Round 3 — Integration & Completeness Review

### Integration Correctness

1. **Pull path (server → client)**: ✅ Fully wired — `KnowledgeStore.updateManifest()` → `pullSnapshot()` → `GET /projects/:id/graph`.
2. **Push path (client → server)**: ❌ Dead — `sync()` method exists but is never invoked.
3. **Orphan branch sync**: ✅ Works within the server-side transaction after successful DB writes.

### Missing Coverage

1. **No `docuvia.sync` command in command palette** — Users cannot trigger sync from VS Code.
2. **No auto-sync on file save or commit** — The infrastructure exists (client method + server endpoint) but there's no automatic trigger.
3. **No sync status indicator** — No UI feedback for sync progress/failures in the VS Code status bar.

---

## Findings Summary

| # | Severity | Category | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | 🔴 | Security | `POST /sync/push` has no `requireApiKey` — unauthenticated CQRS event injection | Open |
| 2 | 🔴 | Feature | No `docuvia.sync` command registered — the "CLI" part is entirely missing | Open |
| 3 | 🟡 | Dead Code | `CentralServerClient.sync()` is fully implemented but never called | Open |
| 4 | 🟡 | Auth | No project-ownership check on sync endpoint — authenticated users can write to any project | Open |

---

## Overall Verdict

**⚠️ WARN**

The server-side sync infrastructure is architecturally sound (advisory locks, transactions, orphan branch writes), and the client SDK method is correctly implemented. However, the feature is only 25% complete: pull works, but the push path is a dead code path with no trigger and no auth gate. The "Bidirectional CLI" is currently a unidirectional pull-only system.
