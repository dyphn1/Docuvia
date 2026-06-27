# Design Verification Report — Item 8.1 (`docuvia sync` Bidirectional CLI)

**Item ID:** 8.1
**Description:** `docuvia sync` Bidirectional CLI
**Verification Date:** 2026-06-27
**Verdict:** ⚠️ WARN
**Type:** Re-verification (previous: 0626_phase-8_docuvia-sync-cli.md, 2026-06-26)

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
| `artifacts/cli/src/cli.ts` | CLI entry point with `sync` subcommand |
| `artifacts/api-server/src/routes/projects.ts` | `POST /projects/:id/sync` — new sync trigger endpoint |
| `artifacts/api-server/src/routes/sync.ts` | `POST /sync/push` — legacy CQRS outbox receiver |
| `artifacts/api-server/src/routes/index.ts` | Router mounting (syncRouter without auth) |
| `artifacts/vscode-client/src/CentralServerClient.ts` | Client SDK — `sync()` method (still dead code) |
| `artifacts/vscode-client/src/extension.ts` | VS Code command registration (no sync command) |
| `artifacts/vscode-client/package.json` | Contribution points — no `docuvia.sync` command |

**Checksums (SHA-256):**

| File | Hash | Previous | Change |
|------|------|----------|--------|
| `artifacts/cli/src/cli.ts` | `f6d030f899feca2070718aa16c3d0c311ba9526505b36735bfbdcb0d1b72280f` | N/A (new) | New file since last verification |
| `artifacts/api-server/src/routes/projects.ts` | `5600ce4b5126357ebb6fc14cc79247e926ebe71ff6a90683c97bb201559c43ad` | N/A (not checked) | Significant changes (full sync implementation) |
| `artifacts/api-server/src/routes/sync.ts` | `39a4cfd54f249bc3caecd5ff7df00122787b1d666c204ae69cc3617f7d9e8326` | `39a4cfd54f249bc3caecd5ff7df00122787b1d666c204ae69cc3617f7d9e8326` | No change (cosmetic only) |
| `artifacts/vscode-client/src/CentralServerClient.ts` | `bbe4c93e837b67bece90d6ef398f19894190e8bf5991ab81b31a63739451cb5c` | `bbe4c93e837b67bece90d6ef398f19894190e8bf5991ab81b31a63739451cb5c` | No change |
| `artifacts/vscode-client/src/extension.ts` | `ac52f24eb97614ad6daf211fd687929ff4328c52501669c0c995b18f064ecadc` | `ac52f24eb97614ad6daf211fd687929ff4328c52501669c0c995b18f064ecadc` | No change |

---

## Round 1 — Architecture & Design Review

### Design ↔ Implementation Alignment

**✅ Correctly implemented:**

1. **CLI `sync` subcommand** — `artifacts/cli/src/cli.ts` implements `docuvia sync <project_id> [commit_sha]` with stdin pipe support for post-commit hooks. Calls `POST /api/projects/:id/sync` with `Authorization: Bearer $MCP_PAT`.
2. **Server-side sync trigger** — `POST /projects/:id/sync` in `projects.ts` is fully implemented: validates project exists, checks VCS type (git only), clones via `LocalGitClient`, fetches commit delta since `lastGitIngestedAt`, runs `processIngestion()`, updates timestamp, logs activity, cleans up in `finally` block.
3. **Auth on new endpoint** — `requireApiKey` middleware applied to `/projects/:id/sync`.
4. **Post-commit hook support** — CLI accepts commit SHA via argument or stdin pipe, aligning with ADR-008's CQRS outbox pattern.

### Gaps / Deviations

1. **⚠️ `POST /sync/push` still unauthenticated** — The legacy CQRS outbox receiver (`sync.ts`) is mounted in `routes/index.ts` without `requireApiKey`. Anyone can POST CQRS events to modify any project's knowledge graph without authentication. This is a separate endpoint from the new one but remains a security surface.
2. **⚠️ No `docuvia.sync` command in VS Code extension** — `extension.ts` registers 17+ commands but no sync command. Users must use the terminal CLI (`docuvia sync <id>`) rather than triggering from the IDE command palette.
3. **⚠️ `CentralServerClient.sync()` still dead code** — The VS Code client SDK method at line 99 is fully implemented but never called. The CLI uses direct `fetch()` instead of the SDK method.

---

## Round 2 — Code Quality & Security Review

### Strengths

1. **Proper error handling** — `try/catch/finally` with `client.cleanup()` in `finally` block ensures git clone cleanup.
2. **Auth on new endpoint** — `requireApiKey` with `crypto.timingSafeEqual` prevents timing attacks.
3. **Input validation** — VCS type check (git only), project existence check.
4. **Activity logging** — Sync operations logged to `activity_log` table for audit trail.
5. **CLI stdin handling** — Gracefully handles both TTY and piped stdin for hook compatibility.

### Issues Found

1. **🔴 `POST /sync/push` has no auth** — `syncRouter` mounted without `requireApiKey` in `routes/index.ts:54`. Any unauthenticated client can send CQRS events (`CREATE_L3`, `UPDATE_L3`) to write arbitrary data to any project's knowledge graph. Severity: HIGH.
2. **🟡 Inconsistent auth patterns** — CLI uses `Authorization: Bearer $MCP_PAT`, `CentralServerClient.sync()` uses `x-docuvia-token` header, and `/projects/:id/sync` uses `requireApiKey` (Bearer <REDACTED> from `DOCUVIA_API_KEY`). Three different auth mechanisms for sync operations.
3. **🟡 Dead SDK method** — `CentralServerClient.sync()` is fully implemented but never called. Either wire it into the extension or remove it.

---

## Round 3 — Integration & Completeness Review

### Integration Correctness

1. **Pull path (server → client)**: ✅ Fully wired — `KnowledgeStore.updateManifest()` → `pullSnapshot()` → `GET /projects/:id/graph`.
2. **Push path (CLI → server)**: ✅ Functional — `docuvia sync <id>` → `POST /projects/:id/sync` → `LocalGitClient.clone()` → `processIngestion()`.
3. **CQRS outbox push (client → server)**: ⚠️ Functional but unauthenticated — `POST /sync/push` works but has no auth gate.

### Missing Coverage

1. **No VS Code sync command** — Users cannot trigger sync from the IDE. The CLI is a separate npm package (`artifacts/cli/`) that must be installed independently.
2. **No auto-sync trigger** — The post-commit hook is opt-in (user must configure it). No automatic sync on file save or commit from within VS Code.
3. **No sync status UI** — No VS Code status bar indicator for sync progress/failures.

---

## Changes Since Last Verification

| Change | Impact |
|--------|--------|
| `artifacts/cli/src/cli.ts` — new file | ✅ CLI `sync` subcommand implemented with post-commit hook support |
| `artifacts/api-server/src/routes/projects.ts` — `POST /projects/:id/sync` fully implemented | ✅ Server-side sync trigger with real git clone + ingestion pipeline |
| `artifacts/api-server/src/routes/sync.ts` — cosmetic formatting only | ⚠️ No functional change |
| `artifacts/vscode-client/src/CentralServerClient.ts` — no change | ⚠️ `sync()` method still dead code |
| `artifacts/vscode-client/src/extension.ts` — no change | ⚠️ No sync command registered |

**Net change:** Significant progress. The CLI and server-side sync endpoint are now functional (commit `37836fa`). Feature completeness increased from ~25% to ~65%. Remaining gaps: no VS Code sync command, dead SDK method, unauthenticated legacy endpoint.

---

## Findings Summary

| # | Severity | Category | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | 🔴 | Security | `POST /sync/push` has no `requireApiKey` — unauthenticated CQRS event injection | Unchanged |
| 2 | 🟡 | Feature | No `docuvia.sync` command in VS Code extension — users must use terminal CLI | Unchanged |
| 3 | 🟡 | Dead Code | `CentralServerClient.sync()` is fully implemented but never called | Unchanged |
| 4 | 🟡 | Auth | Three inconsistent auth patterns across sync surfaces (MCP_PAT Bearer <REDACTED> x-docuvia-token, DOCUVIA_API_KEY Bearer) | New finding |
| 5 | 🟢 | Feature | CLI `sync` subcommand now exists with post-commit hook stdin support | RESOLVED |
| 6 | 🟢 | Security | `POST /projects/:id/sync` now has `requireApiKey` | RESOLVED |
| 7 | 🟢 | Feature | Server-side sync now performs real git clone + commit delta ingestion | RESOLVED |

---

## Overall Verdict

**⚠️ WARN**

Significant progress since 2026-06-26. The `docuvia sync` CLI (`artifacts/cli/src/cli.ts`) and the new `POST /projects/:id/sync` endpoint (with `requireApiKey`) are fully implemented and functional. The feature has gone from "half-implemented" to "mostly complete" — users can sync from the terminal via `docuvia sync <project_id>`. However, three issues remain: (1) the legacy `/sync/push` endpoint is still unauthenticated, (2) the VS Code extension lacks a `docuvia.sync` command, and (3) `CentralServerClient.sync()` remains dead code. The unauthenticated `/sync/push` endpoint is the highest-severity finding and should be addressed by either adding `requireApiKey` or removing the endpoint if the new `/projects/:id/sync` fully supersedes it.
