# GitBook Audit — Outstanding Issues Only

**Supersedes**: Prior audit reports (`gitbook-audit-2026-07-04.md` and `gitbook-audit-2026-07-04-verification.md`) for the purpose of tracking _what's still broken_. Those two files were archived; this file is the live punch list, re-verified directly against source on 2026-07-05.

**Method**: every item below was re-confirmed by reading the current cited code (not by trusting the prior reports). Anything the prior reports flagged as open but that turned out to already be fixed, or refuted, is listed in §3 and removed from the active list.

---

## 1. High Severity

### 1.5 — Single shared identity defeats all IDOR checks

- **Target**: `artifacts/api-server/src/middlewares/auth.ts:36`
- **Status**: 🟡 Live limitation, but honestly documented (not a hidden bug) — see `docs/gitbook/architecture/crosscutting-concepts.md` §8.4 "Single-Tenant Auth (Current Limitation)"
- Every request authenticated via the single shared `DOCUVIA_API_KEY` resolves to `{ id: 1 }`. Downstream `ownerId !== userId` checks in `export.ts`, `sync.ts`, `review-tasks.service.ts` are real but inert — they can never reject, because there is no second real user.
- **Required action**: implement a real `users`/`api_keys` table + per-key identity resolution before any multi-tenant use. **Deferred by user decision (2026-07-05)** — large-scope schema/migration work, not a quick fix. Tracked as backlog.

---

## 2. Medium Severity

### 2.1 — Two disconnected local-persistence pipelines

- **Target**: `artifacts/cli/src/commands/sync.ts:30-88` vs. `lib/core/src/services/sqlite-graph.repository.ts`
- **Status**: 🟡 Live, already documented — see `docs/gitbook/evaluate/local-sqlite-write-pipeline.md` "Current State (as of 2026-07-05) — Two Disconnected Pipelines"
- `analyze` writes L2/L3 nodes into `.docuvia/local.db` via `SqliteGraphRepository`. `sync --local` re-parses the AST into a discarded temp dir and writes straight to the git orphan branch. Running one does not update the other's data.
- **Required action**: route `sync --local` through `SqliteGraphRepository`/`.docuvia/local.db` instead of a throwaway temp dir. Explicitly called out in the doc as "a real pipeline rewrite, tracked separately" — not attempted here; **deferred, backlog**.

### 2.2 — ADR-017 GC / hot-cold tiered storage entirely unimplemented

- **Target**: `l2NodesTable` / `l3NodesTable` schemas (`lib/db/src/schema/pg/`)
- **Status**: 🔴 Missing — no `is_active`/tombstone column, no archival job, no hydrate-from-branch code anywhere.
- **Required action**: implement the ADR-017 tombstone + GC + hydrate flow, or formally mark ADR-017 as aspirational in docs. **Deferred by user decision (2026-07-05)** — full subsystem, not a quick fix. Tracked as backlog.

---

## 3. Low Severity / Incomplete Features (roadmap-level, not correctness bugs)

These are unbuilt or stubbed features, not silent bugs — most already say so honestly in their own code/docs. Not scheduled this pass.

- **`autoCategorizeDecisionsCommand` is a no-op** — `artifacts/vscode-client/src/commands/decision.ts:6-13` just shows an info message ("handled by the server ingestion pipeline"); no client-side logic exists.
- **GitHub push-event handling is an explicit stub** — `github-webhook.service.ts:78`: `"Push event received but not fully implemented yet"`.
- **ADR-011 branch-merge detection** — no `isMerged`/`mergeStatus` field anywhere in `lib/`.
- **4D edge types** (`IMPLEMENTS`/`EXPLAINS`/`EVOLVED_INTO`/`HAS_RULE`, ADR-018) — `node-links.ts` only has a free-text `linkType`; not structurally representable yet.
- **`docuvia visualize` CLI command** — does not exist in `cli.ts`; no D3/Mermaid dependency.
- **VS Code interactive topology webview** — `dashboard-panel.ts` only renders stats/counts.
- **Git-diff-scoped incremental sync** — `sync --local` always does a full `discoverFiles` rediscovery.
- **CLI ↔ MCP parity tests** — still a stub (`it("should be skipped", () => {})`).
- **ADR-009 token management** (L3/L2/L1 weight allocation, token budget constant, `tiktoken`) — not implemented.
- **Performance targets** (`quality-requirements.md`: p95<2s, ingestion<30s, etc.) — no enforcing code, tests, or CI gates.
- **DLQ "3 failures → error_reports"** (`quality-requirements.md`) — no retry-count logic; `error_reports` is written on the first failure.
- **ADR-026 multi-provider LLM abstraction** — correctly labeled "Proposed" in its own doc, code is OpenAI/Ollama only. Not a bug, just not yet accepted/built.

---

## 4. Confirmed Already Fixed Since the 2026-07-04 Verification Pass

For completeness — these were still open as of the verification pass but are now confirmed fixed by direct code read on 2026-07-05, so they are **removed from the active list**:

| Finding                                                   | Evidence it's fixed                                                                                                                                                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.21 — no retry/backoff on single (audio/image) LLM calls | `lib/integrations-openai-ai-server/src/audio/client.ts` and `image/client.ts` now wrap every call site in `withLlmRetry()` from the shared `client.ts`                                                                                          |
| 1.13 — UI kit duplicated between kg-engine/mockup-sandbox | All 53 `components/ui/*.tsx` files in both apps are now 1-line re-export shims to `@workspace/ui-kit` (e.g. `export * from "@workspace/ui-kit/components/Button";`); the real implementation lives in `lib/ui-kit/src/components/` exactly once |
| 1.14 — hardcoded dev-secret fallback                      | `metabolism.ts` now fails closed unconditionally, no fallback                                                                                                                                                                                   |
| 1.7 — rate limiting bypassed for webhook/proxy routes     | `app.ts` applies `standardLimiter`/`mcpLimiter` directly to both routes                                                                                                                                                                         |
| 1.1 — orphan branch writer no filesystem isolation        | explicit `cwd` via `DOCUVIA_KNOWLEDGE_REPO_PATH`                                                                                                                                                                                                |
| 1.10 — worker pool no timeout/quarantine                  | `ast-worker-pool.ts` now has `taskTimeouts` + forced `terminate()` + shutdown-safe respawn                                                                                                                                                      |
| 1.12 — embeddings never regenerated                       | `l3-nodes.service.ts` and `review-tasks.service.ts` both recompute `embedding` on title/content change                                                                                                                                          |
| 3.7 — scope-resolver drops most call targets              | now has `resolveBareImport` (node_modules/package.json lookup) + extensions for py/rs/go/java/cpp                                                                                                                                               |
| 2-table-row-11 — TaskQueue tree view never populated      | `addTask`/`updateTaskStatus` wired into `extraction.ts` / `extract.ts` / `task-queue-tree-provider.ts`                                                                                                                                          |
| 3.1 — `extraction.ts` omits `l2_node_id`                  | now resolves via `resolveL2NodeIdForFile` and includes it in the INSERT                                                                                                                                                                         |

---

## 5. Summary

After re-verification, there are **no small-scope live bugs left unaddressed**. The three remaining open items (§1–2) are all legitimate architecture-level gaps that are already honestly documented as known limitations/backlog in their respective docs, and — per explicit decision on 2026-07-05 — are deferred rather than attempted as quick fixes:

1. Single-tenant auth (§1.5) — needs a `users`/`api_keys` table + migration.
2. Two disconnected local-persistence pipelines (§2.1) — needs a pipeline rewrite of `sync --local`.
3. ADR-017 GC/tiered storage (§2.2) — needs a new subsystem (tombstones + archival job + hydrate logic).

Everything else previously flagged as a live, small-scope bug (1.21, 1.13, 1.14, 1.7, 1.1, 1.10, 1.12, 3.7, TaskQueue tree view, 3.1) has been fixed in the commits landed between 2026-07-04 and 2026-07-05.
