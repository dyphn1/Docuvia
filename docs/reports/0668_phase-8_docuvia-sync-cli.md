# Design Verification Report — Item 8.1 (`docuvia sync` Bidirectional CLI)

**Item ID:** 8.1
**Description:** `docuvia sync` Bidirectional CLI
**Verification Date:** 2026-06-28
**Verdict:** ⚠️ WARN
**Type:** Re-verification (previous: 0636_phase-8_docuvia-sync-cli.md, 2026-06-27)

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

| File | Hash | Previous (0636) | Change |
|------|------|-----------------|--------|
| `artifacts/cli/src/cli.ts` | `3e7a59d3f04cee9b26c229de274b305e643481d0976fbaded637f07ed932887a` | `f6d030f899feca2070718aa16c3d0c311ba9526505b36735bfbdcb0d1b72280f` | CHANGED (c3de191: added init/analyze/extract commands, refactored error handling) |
| `artifacts/api-server/src/routes/projects.ts` | `b63b9d6cdb9732d3a512ee1e5f3541f3bde2c6c27b4e2802bc4a21cd3045d0a1` | `5600ce4b5126357ebb6fc14cc79247e926ebe71ff6a90683c97bb201559c43ad` | CHANGED (36d93ba: added /projects/:id/graph node_links response) |
| `artifacts/api-server/src/routes/sync.ts` | `39a4cfd54f249bc3caecd5ff7df00122787b1d666c204ae69cc3617f7d9e8326` | `39a4cfd54f249bc3caecd5ff7df00122787b1d666c204ae69cc3617f7d9e8326` | No change |
| `artifacts/api-server/src/routes/index.ts` | `1ae78f08599e661a4eedebc26f96d1ed4e80cc60457a596a3239bb392f65a6be` | N/A (not in prior report) | New — syncRouter mounted without auth |
| `artifacts/vscode-client/src/CentralServerClient.ts` | `55f35bdd7972167975f68dda4530806104ac2b4ac1b82211fe4cf25202814e30` | `bbe4c93e837b67bece90d6ef398f19894190e8bf5991ab81b31a63739451cb5c` | CHANGED (c3de191: refactored to use @workspace/core) |
| `artifacts/vscode-client/src/extension.ts` | `1e93b288f4792f3d58e5d41288b6772fc34f5e0f334cea525e7e2d931ec75bbf` | `ac52f24eb97614ad6daf211fd687929ff4328c52501669c0c995b18f064ecadc` | CHANGED (c3de191: major refactor to local SQLite architecture) |

---

## Round 1 — Architecture & Design Review

### Design ↔ Implementation Alignment

**✅ Correctly implemented:**

1. **CLI `sync` subcommand** — `artifacts/cli/src/cli.ts` implements `docuvia sync <project_id> [commit_sha]` with stdin pipe support for post-commit hooks. Calls `POST /api/projects/:id/sync` with `Authorization: Bearer <REDACTED> (MCP_PAT env var).
2. **Server-side sync trigger** — `POST /projects/:id/sync` in `projects.ts` (line 260) is fully implemented with `requireApiKey` middleware: validates project exists, checks VCS type (git only), clones via `LocalGitClient`, fetches commit delta since `lastGitIngestedAt`, runs `processIngestion()`, updates timestamp, logs activity, cleans up in `finally` block.
3. **Auth on new endpoint** — `requireApiKey` middleware applied to `/projects/:id/sync` (line 260 of projects.ts).
4. **Post-commit hook support** — CLI accepts commit SHA via argument or stdin pipe, aligning with ADR-008's CQRS outbox pattern.
5. **Shared Core API refactor (ADR-021)** — Commit `c3de191` successfully refactored CLI, MCP Server, and VS Code Client to delegate to `@workspace/core`. This is an architectural improvement that aligns with ADR-021.

### Gaps / Deviations

1. **⚠️ `POST /sync/push` still unauthenticated** — The legacy CQRS outbox receiver (`sync.ts`) is mounted in `routes/index.ts` (line 54) as `router.use(syncRouter)` without `requireApiKey`. Anyone can POST CQRS events (`CREATE_L3`, `UPDATE_L3`) to modify any project's knowledge graph without authentication. This is a separate endpoint from the new `/projects/:id/sync` but remains a security surface.
2. **⚠️ No `docuvia.sync` command in VS Code extension** — `extension.ts` registers 20+ commands (including `docuvia.graph.traverse` added in c3de191) but no sync command. Users must use the terminal CLI (`docuvia sync <id>`) rather than triggering from the IDE command palette.
3. **⚠️ `CentralServerClient.sync()` still dead code** — The VS Code client SDK method at line 99 is fully implemented but never called from extension.ts or any other file. The CLI uses direct `fetch()` instead of the SDK method.

---

## Round 2 — Code Quality & Security Review

### Strengths

1. **Proper error handling** — `try/catch/finally` with `client.cleanup()` in `finally` block ensures git clone cleanup.
2. **Auth on new endpoint** — `requireApiKey` with `crypto.timingSafeEqual` prevents timing attacks.
3. **Input validation** — VCS type check (git only), project existence check.
4. **Activity logging** — Sync operations logged to `activity_log` table for audit trail.
5. **CLI stdin handling** — Gracefully handles both TTY and piped stdin for hook compatibility.
6. **Improved error messages (c3de191)** — The refactor added more descriptive error messages and a proper usage guide in the CLI.
7. **Architectural improvement (c3de191)** — ADR-021 shared core implementation centralizes business logic, reducing duplication across CLI/MCP/VSCode layers.

### Issues Found

1. **🔴 `POST /sync/push` has no auth** — `syncRouter` mounted without `requireApiKey` in `routes/index.ts:54`. Any unauthenticated client can send CQRS events to write arbitrary data to any project's knowledge graph. Severity: HIGH. The c3de191 refactor did NOT address this.
2. **🟡 Inconsistent auth patterns** — CLI uses `Authorization: Bearer <REDACTED> (MCP_PAT), `CentralServerClient.sync()` uses `x-docuvia-token` header, and `/projects/:id/sync` uses `requireApiKey` (Bearer <REDACTED> from `DOCUVIA_API_KEY`). Three different auth mechanisms for sync operations. The c3de191 refactor preserved all three patterns.
3. **🟡 Dead SDK method** — `CentralServerClient.sync()` is fully implemented but never called. The c3de191 refactor did NOT wire it into the extension.

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
| `artifacts/cli/src/cli.ts` — added init/analyze/extract commands, improved error messages (c3de191) | ✅ Positive — better CLI UX, but sync logic unchanged |
| `artifacts/api-server/src/routes/projects.ts` — added `/projects/:id/graph` node_links response (36d93ba) | ✅ Positive — unrelated to sync, improves graph API |
| `artifacts/api-server/src/routes/sync.ts` — no change | ⚠️ Auth gap unaddressed |
| `artifacts/vscode-client/src/CentralServerClient.ts` — refactored to use @workspace/core (c3de191) | ✅ Positive — architectural improvement, but sync() still dead |
| `artifacts/vscode-client/src/extension.ts` — major refactor to local SQLite, added graph.traverse command (c3de191) | ✅ Positive — but no sync command added |
| `artifacts/api-server/src/routes/index.ts` — no change to syncRouter mounting | ⚠️ Auth gap unaddressed |

**Net change:** Significant architectural improvement (ADR-021 shared core, local SQLite migration) in c3de191, but **none of the 3 prior findings were addressed**. The refactor was focused on architecture and new commands, not on closing the sync security/feature gaps.

---

## Findings Summary

| # | Severity | Category | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | 🔴 | Security | `POST /sync/push` has no `requireApiKey` — unauthenticated CQRS event injection | Unchanged |
| 2 | 🟡 | Feature | No `docuvia.sync` command in VS Code extension — users must use terminal CLI | Unchanged |
| 3 | 🟡 | Dead Code | `CentralServerClient.sync()` is fully implemented but never called | Unchanged |
| 4 | 🟡 | Auth | Three inconsistent auth patterns across sync surfaces (MCP_PAT Bearer <REDACTED> x-docuvia-token, DOCUVIA_API_KEY Bearer) | Unchanged |
| 5 | 🟢 | Feature | CLI `sync` subcommand with post-commit hook stdin support | RESOLVED (since 0626) |
| 6 | 🟢 | Security | `POST /projects/:id/sync` has `requireApiKey` | RESOLVED (since 0626) |
| 7 | 🟢 | Feature | Server-side sync performs real git clone + commit delta ingestion | RESOLVED (since 0626) |
| 8 | 🟢 | Architecture | ADR-021 shared core API implemented; local SQLite migration complete | RESOLVED (c3de191) |

---

## Overall Verdict

**⚠️ WARN**

The c3de191 refactor (`refactor(core): implement shared core API and resolve architectural leaks`) delivered significant architectural improvements — ADR-021 hexagonal architecture, new CLI commands (init, analyze, extract), and VS Code client migration to local SQLite. However, it did **not** address any of the three open findings from the prior verification:

1. The legacy `POST /sync/push` endpoint remains unauthenticated (🔴 security risk)
2. The VS Code extension still lacks a `docuvia.sync` command (🟡 feature gap)
3. `CentralServerClient.sync()` remains dead code (🟡 dead code)

The sync CLI feature itself is functionally complete for terminal users (CLI → server → ingestion pipeline works end-to-end). The remaining gaps are a security hardening issue (auth on legacy endpoint) and two IDE integration issues (no sync command, dead SDK method).

**Recommendation:** Priority order for the Developer Agent:
1. Add `requireApiKey` to `sync.ts` or remove it if `/projects/:id/sync` fully supersedes it (resolves 🔴)
2. Register `docuvia.sync` command in extension.ts that triggers the same flow as the CLI (resolves 🟡)
3. Either wire `CentralServerClient.sync()` into the extension or remove the dead method (resolves 🟡)
