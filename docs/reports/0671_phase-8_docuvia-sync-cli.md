# Design Verification Report — Item 8.1 (`docuvia sync` Bidirectional CLI)

**Item ID:** 8.1
**Description:** `docuvia sync` Bidirectional CLI
**Verification Date:** 2026-06-28
**Verdict:** ⚠️ WARN
**Type:** Re-verification (previous: 0668_phase-8_docuvia-sync-cli.md, 2026-06-28)

---

## Design Spec References

| Document | Section | Description |
|----------|---------|-------------|
| ADR-008-asynchronous-metabolism.md | CQRS Outbox | Sync push implements CQRS outbox pattern for knowledge mutations |
| ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md | Git Sync | Underlying `writeKnowledgeToOrphanBranch` writes knowledge to orphan branch |
| ADR-021-hexagonal-architecture-and-shared-core-api.md | Shared Core | Business logic centralized in @workspace/core (c3de191) |

---

## Source Files Examined

| File | Purpose |
|------|---------|
| `artifacts/cli/src/cli.ts` | CLI entry point with `sync` subcommand |
| `artifacts/api-server/src/routes/projects.ts` | `POST /projects/:id/sync` — new sync trigger endpoint |
| `artifacts/api-server/src/routes/sync.ts` | `POST /sync/push` — legacy CQRS outbox receiver |
| `artifacts/api-server/src/routes/index.ts` | Router mounting (syncRouter without auth) |
| `artifacts/vscode-client/src/CentralServerClient.ts` | Client SDK — `sync()` method (still dead code) |
| `artifacts/vscode-client/src/extension.ts` | VS Code command registration (no sync command) |

**Checksums (SHA-256):**

| File | Working Tree Hash | Committed Hash | Previous (Report 0668) | Change |
|------|-------------------|----------------|------------------------|--------|
| `artifacts/cli/src/cli.ts` | `3e7a59d3f04cee9b26c229de274b305e643481d0976fbaded637f07ed932887a` | `3e7a59d3f04cee9b26c229de274b305e643481d0976fbaded637f07ed932887a` | `3e7a59d3f04cee9b26c229de274b305e643481d0976fbaded637f07ed932887a` | Unchanged |
| `artifacts/api-server/src/routes/projects.ts` | `b63b9d6cdb9732d3a512ee1e5f3541f3bde2c6c27b4e2802bc4a21cd3045d0a1` | `b63b9d6cdb9732d3a512ee1e5f3541f3bde2c6c27b4e2802bc4a21cd3045d0a1` | `b63b9d6cdb9732d3a512ee1e5f3541f3bde2c6c27b4e2802bc4a21cd3045d0a1` | Unchanged |
| `artifacts/api-server/src/routes/sync.ts` | `39a4cfd54f249bc3caecd5ff7df00122787b1d666c204ae69cc3617f7d9e8326` | `39a4cfd54f249bc3caecd5ff7df00122787b1d666c204ae69cc3617f7d9e8326` | `39a4cfd54f249bc3caecd5ff7df00122787b1d666c204ae69cc3617f7d9e8326` | Unchanged |
| `artifacts/api-server/src/routes/index.ts` | `1ae78f08599e661a4eedebc26f96d1ed4e80cc60457a596a3239bb392f65a6be` | `1ae78f08599e661a4eedebc26f96d1ed4e80cc60457a596a3239bb392f65a6be` | `1ae78f08599e661a4eedebc26f96d1ed4e80cc60457a596a3239bb392f65a6be` | Unchanged |
| `artifacts/vscode-client/src/CentralServerClient.ts` | `55f35bdd7972167975f68dda4530806104ac2b4ac1b82211fe4cf25202814e30` | `55f35bdd7972167975f68dda4530806104ac2b4ac1b82211fe4cf25202814e30` | `55f35bdd7972167975f68dda4530806104ac2b4ac1b82211fe4cf25202814e30` | Unchanged |
| `artifacts/vscode-client/src/extension.ts` | `1e93b288f4792f3d58e5d41288b6772fc34f5e0f334cea525e7e2d931ec75bbf` | `1e93b288f4792f3d58e5d41288b6772fc34f5e0f334cea525e7e2d931ec75bbf` | `1e93b288f4792f3d58e5d41288b6772fc34f5e0f334cea525e7e2d931ec75bbf` | Unchanged |

---

## Round 1 — Architecture & Design Review

### Design ↔ Implementation Alignment

**✅ Correctly implemented:**

1. CLI `sync` subcommand with post-commit hook stdin support (RESOLVED since 0626)
2. `POST /projects/:id/sync` has `requireApiKey` auth (RESOLVED since 0626)
3. Server-side sync performs real git clone + commit delta ingestion (RESOLVED since 0626)
4. ADR-021 shared core API implemented; local SQLite migration complete (RESOLVED c3de191)

### Gaps / Deviations

1. **❌ `POST /sync/push` has no `requireApiKey`** — The legacy CQRS outbox receiver remains unauthenticated. Any client can send arbitrary L3 node creation events to the server without API key. This is a 🔴 security risk.

2. **⚠️ No `docuvia.sync` command in VS Code extension** — Users must use the terminal CLI. The IDE integration gap persists.

3. **⚠️ `CentralServerClient.sync()` is dead code** — Fully implemented but never called from any extension command or CodeLens handler.

---

## Round 2 — Code Quality & Security Review

### Strengths

1. `POST /projects/:id/sync` correctly uses `requireApiKey` middleware
2. Advisory lock (`pg_try_advisory_xact_lock`) prevents concurrent sync conflicts
3. Transaction wrapping ensures atomic L3 node creation
4. Input validation via `SyncPushBody.safeParse()` Zod schema

### Issues Found

1. **🔴 `POST /sync/push` unauthenticated** — No `requireApiKey` middleware. The endpoint accepts CQRS outbox events and writes directly to the database without any authentication. This is exploitable for unauthorized data injection.
   - **File:** `artifacts/api-server/src/routes/sync.ts` line 14
   - **Fix:** Add `requireApiKey` middleware or remove the endpoint if `/projects/:id/sync` fully supersedes it.

2. **🟡 Inconsistent auth patterns** — Three different auth mechanisms across sync surfaces (MCP_PAT Bearer <REDACTED> x-docuvia-token, DOCUVIA_API_KEY Bearer <REDACTED> The legacy endpoint has none.

---

## Round 3 — Integration & Completeness Review

### Integration Correctness

1. CLI → Server sync flow works end-to-end (CLI reads git diff, sends to `/projects/:id/sync`, server ingests)
2. The c3de191 refactor improved architecture (shared core, new CLI commands) without breaking sync functionality

### Missing Coverage

1. **Legacy endpoint auth** — `POST /sync/push` should either be authenticated or removed
2. **VS Code sync command** — No IDE integration for sync workflow
3. **Dead SDK method** — `CentralServerClient.sync()` unused

---

## Changes Since Last Verification

| Change | Impact |
|--------|--------|
| None — `sync.ts` checksum identical (`39a4cfd54f...`) | No change to sync auth logic |
| `cli.ts` unchanged (same checksum) | No change to CLI sync command |
| `projects.ts` unchanged (same checksum) | No change to `/projects/:id/sync` endpoint |
| `CentralServerClient.ts` unchanged (same checksum) | No change to dead `sync()` method |
| `extension.ts` unchanged (same checksum) | No change to missing VS Code sync command |
| `index.ts` unchanged (same checksum) | No change to router mounting |

**Net change:** No code changes since 2026-06-28. All findings are carried forward.

---

## Findings Summary

| # | Severity | Category | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | 🔴 | Security | `POST /sync/push` has no `requireApiKey` — unauthenticated CQRS event injection | Unchanged |
| 2 | 🟡 | Feature | No `docuvia.sync` command in VS Code extension — users must use terminal CLI | Unchanged |
| 3 | 🟡 | Dead Code | `CentralServerClient.sync()` is fully implemented but never called | Unchanged |
| 4 | 🟡 | Auth | Three inconsistent auth patterns across sync surfaces | Unchanged |
| 5 | 🟢 | Feature | CLI `sync` subcommand with post-commit hook stdin support | RESOLVED (since 0626) |
| 6 | 🟢 | Security | `POST /projects/:id/sync` has `requireApiKey` | RESOLVED (since 0626) |
| 7 | 🟢 | Feature | Server-side sync performs real git clone + commit delta ingestion | RESOLVED (since 0626) |
| 8 | 🟢 | Architecture | ADR-021 shared core API implemented; local SQLite migration complete | RESOLVED (c3de191) |

---

## Overall Verdict

**⚠️ WARN**

No code changes since the previous verification (2026-06-28). All source file checksums are identical to report 0668. The three open findings are carried forward unchanged:

1. **🔴 `POST /sync/push` unauthenticated** — The legacy CQRS outbox receiver at `artifacts/api-server/src/routes/sync.ts:14` has no `requireApiKey` middleware. This allows unauthenticated L3 node creation. **Recommendation:** Add `requireApiKey` to the router or remove the endpoint if `POST /projects/:id/sync` fully supersedes it.
2. **🟡 No VS Code sync command** — The extension lacks a `docuvia.sync` command that mirrors the CLI workflow.
3. **🟡 Dead `CentralServerClient.sync()`** — The SDK method is implemented but never invoked from any extension code path.

The sync CLI feature remains functionally complete for terminal users. The remaining gaps are one security hardening issue and two IDE integration issues.

**Recommendation:** Priority order for the Developer Agent:
1. Add `requireApiKey` to `sync.ts` or remove it if `/projects/:id/sync` fully supersedes it (resolves 🔴)
2. Register `docuvia.sync` command in extension.ts that triggers the same flow as the CLI (resolves 🟡)
3. Either wire `CentralServerClient.sync()` into the extension or remove the dead method (resolves 🟡)
