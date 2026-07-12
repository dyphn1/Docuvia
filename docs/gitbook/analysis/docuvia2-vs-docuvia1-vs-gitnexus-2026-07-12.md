# Docuvia2 vs Docuvia1 vs GitNexus — Command & Architecture Comparison (2026-07-12)

> **Status**: Findings + recommendations, written after landing the STOR-001/002 git-native round-trip (node identity, continuous stacking, hydration, cross-clone reconciliation — commits `e997af2`/`551f574`). Builds directly on Docuvia1's own prior audits ([`docuvia-cli-vs-gitnexus-2026-07-10.md`](../../../../Docuvia/docs/analysis/docuvia-cli-vs-gitnexus-2026-07-10.md), [`gitnexus-vs-docuvia-full-command-matrix-2026-07-11.md`](../../../../Docuvia/docs/analysis/gitnexus-vs-docuvia-full-command-matrix-2026-07-11.md)) rather than re-deriving GitNexus's surface from scratch.

## Methodology

- **Docuvia2**: this repo, `artifacts/cli/src/constants/cli-commands.ts` — 13 commands, read directly from source. Build verified clean (`pnpm run build`, all workspace packages) immediately before this comparison.
- **Docuvia1**: sibling checkout at `D:\GitHub\Docuvia`, `artifacts/cli/src/constants/cli-commands.ts` + `cli.ts` — 11 commands, all confirmed wired to a real handler by reading `COMMAND_HANDLERS` directly (the July-11 audit's "10 commands, `impact` not yet standalone" finding has since been fixed on that side too — `impact` is wired there now).
- **GitNexus**: `D:\GitHub\GitNexus\gitnexus`, `gitnexus@1.6.9` — same version the July-11 Docuvia1 audit used, confirmed via `package.json` and by re-enumerating every `.command(...)` registration in `src/cli/index.ts` (23 commands + `help`, identical set — no drift since that audit, so its per-command findings are reused here rather than re-verified line-by-line).
- Every architectural claim below (does Docuvia1 have hydration? does GitNexus commit its index to git for team sharing?) was checked against actual source, not documentation — see the inline file references.

---

## Part 1 — Docuvia1 → Docuvia2 lineage

Docuvia2 is not a superset rewrite of Docuvia1 — it's **narrower in product surface, deeper in the one architectural problem Docuvia1 never actually solved.**

### 1a. Product surface (what got cut)

| Surface | Docuvia1 | Docuvia2 | Notes |
|---|---|---|---|
| CLI | ✅ `artifacts/cli` | ✅ `artifacts/cli` | Both present; command-level diff in 1b below. |
| Web dashboard | ✅ `artifacts/kg-engine` (React/Vite/Radix/TanStack) | ❌ absent | No graph-browsing UI in Docuvia2 at all. |
| API server | ✅ `artifacts/api-server` | ❌ absent | Docuvia2's `sync` command talks to a remote backend, but that backend's implementation isn't part of this repo (`lib/remote-api` is a thin HTTP client only). |
| VS Code extension | ✅ `artifacts/vscode-client` | ❌ absent | |
| LLM orchestration | ✅ `lib/llm-orchestrator` — real invocation paths | ❌ absent — `docs/gitbook/adr/llm/README.md`: *"Currently, there are no LLM invocation paths (including `analyze <path>`)"* | Confirmed both in ADR text and by reading `lib/ui-core/src/workflows/analyze/analyze-workflow.ts`: Docuvia2's `analyze` is config/tag detection only (`ConfigScannerService.scanConfigs`), not decision extraction. |
| LSP integration | ✅ `lib/headless-lsp` | ❌ absent — `IMPT-002` ADR: *"Architecture accepted, Pending Implementation"* | `impact --escalateToLsp` exists as a flag in both Docuvia1 and Docuvia2 but is a documented no-op in Docuvia2. |
| Domain plugin system | ✅ `lib/plugins-domain` | ❌ absent | |

This matches the `legacy/README.md` mapping table's own framing: roughly a third of Docuvia1's ADRs are marked **"Removed (Overly ambitious vision)"** — Docuvia2 is a deliberate CLI-first re-scoping, not an incomplete port.

### 1b. CLI command surface (what's the same, what's new)

| Docuvia1 command | Docuvia2 command | Diff |
|---|---|---|
| `init` | `init` | Same role (index + agent-hook setup fused into one call — see GitNexus comparison below for why this is a debatable design choice). |
| `analyze [path] [--deep]` (LLM decision extraction) | `analyze` (config/tag detection only) | **Function changed, not just renamed.** Docuvia1's `analyze` called an LLM; Docuvia2's doesn't call one at all yet. |
| `query <target>` | `query <target>` | Same paradigm (exact/fuzzy name lookup, not concept search). |
| `impact <target>` | `impact <target>` | Same on both sides now (Docuvia1 closed its own "not standalone" gap since the July-11 audit). |
| `review [--baseRef]` | `review [--baseRef]` | Same (file-level, not hunk-level, change-impact + risk score). |
| `snapshot` | `snapshot` | **Behaviorally fixed, not just present.** Docuvia1's snapshot wrote a fresh, parentless root commit *every single time* — no equivalent of `git log docuvia-knowledge` ever showing more than one reachable commit (verified: `grep -rn "hydrat" lib/core/src` in Docuvia1 returns **zero matches** — the read-back direction was never built, and `local-orphan-branch-writer.ts` has no parent-chaining logic). Docuvia2's `snapshot` parents each commit on the branch's prior tip and stamps it with a `Docuvia-Source` trailer (STOR-001 points 2/4). |
| `sync <project_id> [sha]` | `sync <project_id> [sha]` | Same (push L3 decisions to a remote HTTP backend). |
| `status` | `status` | Same. |
| `clean` | `clean` | Same (still no `--force`/`--all`, per the Docuvia1 audit's cosmetic finding — unaddressed on both sides). |
| `export --topology [--json]` | `export-topology` | Cosmetic rename to its own top-level command instead of a flag. |
| `mcp` | `mcp` | Same (stdio-only on both). |
| — | **`hydrate`** | **New.** Rebuilds `local.db` from the knowledge branch (STOR-002) — Docuvia1 never had a git→SQLite direction at all. |
| — | **`sync-knowledge`** | **New.** Fetches/merges/pushes the knowledge branch across clones (STOR-001 point 3) — Docuvia1's `sync` only ever pushed *decisions* to a server; nothing reconciled the knowledge branch itself between two developers' machines. |

**The headline finding**: Docuvia1 had the *idea* of "git branch as source of truth" (`orphan-branch-writer.ts`, ADR-004/014) but never closed the loop — no hydration, no parenting, no cross-clone merge. It could write to git; it could not reliably read back from it, and two developers' knowledge branches would silently clobber each other on push (last writer wins, no divergence detection — same root cause as the "6-minute hydration" story in `STOR-002`'s Context section, which describes *why the team gave up on git-first*, not a fix for it). Docuvia2's Phase 0–3 work is the first time in this product's history the full round trip — write → hydrate → reconcile — actually exists and is tested (109+ tests across the storage layer alone).

---

## Part 2 — Docuvia2 vs GitNexus (full command matrix)

GitNexus is a **single-machine, ephemeral code-intelligence tool**: deep static analysis (PDG, taint tracking, cross-repo impact, Leiden community detection, Cypher queries), zero team-sharing story. Docuvia2 is the inverse: shallow single-hop analysis, but git-native, versioned, team-shareable by design. Verified directly, not assumed — `D:\GitHub\GitNexus\gitnexus\src\storage\branch-index.ts` (GitNexus's per-branch cache) contains **zero** references to `push`/`remote`/`fetch`/`commit` — it's a local cache keyed by branch name, solving *checkout thrashing* (the same problem Docuvia2's still-deferred STOR-004/005 targets), never *team distribution*.

| GitNexus command | Docuvia2 equivalent | Function | Gap type |
|---|---|---|---|
| `setup` | `init` (bundled) | Editor/MCP registration | GitNexus separates "wire up my editor" from "index the repo"; Docuvia2 still fuses them into one `init` call (unchanged from Docuvia1). |
| `uninstall` | — | Reverse everything `setup`/`init` wrote | **Real gap**, inherited unchanged from Docuvia1. `init` writes 8+ files/hooks; `clean` only wipes `local.db`. |
| `analyze [path]` (full indexer) | `init` | Full AST index | Naming collision risk is *gone* now — Docuvia2's `analyze` no longer does anything LLM-related, so it no longer collides in a misleading way the way Docuvia1's did. |
| `index [path...]`, `list`, `remove`, `group` | — | Multi-repo registry | Architectural difference, not a bug — Docuvia2 has no cross-repo concept (unchanged from Docuvia1). |
| `serve` | — | Local web UI | Unchanged gap. |
| `mcp` | `mcp` ✅ | MCP stdio server | GitNexus also offers `--http`; Docuvia2 is stdio-only (low priority, per Docuvia1's own prior assessment — still valid). |
| `status` | `status` ✅ | Index health | Same. |
| `doctor` | — | Environment/capability diagnostics | Unchanged gap — arguably *more* valuable for Docuvia2 now, given `sync-knowledge`'s new network/remote failure modes (no-remote vs. offline vs. auth failure are currently indistinguishable to a user beyond a log line). |
| `clean` | `clean` ✅ | Wipe index | Missing `--force`/`--all`, unchanged. |
| `wiki [path]` | — | Generate prose docs from the graph | Unchanged gap. Docuvia2's closest artifact is still `export-topology`'s HTML graph viewer, not prose. |
| `augment <pattern>` | `query --local --format=prompt` (hook-only) | Inject KG context into an agent | Unchanged — still only reachable via the generated hook script, not directly callable. |
| `publish [path]` | — | Public registry freshness ping | Not applicable to Docuvia2's private-team model — unchanged assessment. |
| `query [search]` | `query <target>` (partial) | Concept search vs. name lookup | Unchanged data-model gap — Docuvia2 still has no execution-flow/process abstraction. |
| `context [name]` | `query` (partial) | Caller/callee + process membership | Unchanged — caller/callee half works, "processes" half doesn't exist. |
| `impact [target]` | `impact <target>` ✅ | Blast radius with risk level | **Gap closed** (was Docuvia1's single cheapest recommended fix — now shipped on both Docuvia1 and Docuvia2 independently). |
| `trace <from> <to>` | — | Shortest path between two symbols | Unchanged gap — genuinely new feature, not wiring. |
| `cypher <query>` | — | Raw graph query | Architecturally inapplicable — Docuvia2 is relational SQLite, not a graph DB. Unchanged. |
| `detect-changes` | `review` (partial) | Diff → affected symbols/flows | Unchanged — file-level, not hunk-level; no flow grouping. |
| `check` | — | Structural graph validation | Unchanged gap. |
| `eval-server` | — | Internal GitNexus tooling | Not a real comparison point. |
| `help` | usage text ✅ | | Same. |
| — | **`snapshot`** | Commit the graph into git itself, no server | Still Docuvia's own differentiator — GitNexus has no equivalent at all (its persistence is local files or the opt-in `publish` ping, never a git commit). |
| — | **`hydrate`** | Rebuild `local.db` from the knowledge branch | **New relative to the Docuvia1 audit.** No GitNexus equivalent — GitNexus's branch cache is local-only, so it has nothing analogous to "restore state a teammate produced." |
| — | **`sync-knowledge`** | Fetch/merge/push the knowledge branch across clones | **New relative to the Docuvia1 audit.** No GitNexus equivalent whatsoever — this is the one capability in this entire matrix that has no counterpart on *either* side (Docuvia1 or GitNexus): reconciling two independently-evolved, versioned knowledge graphs via a real merge algorithm. |

---

## Recommendations

Ranked by the same "near-zero-cost first" logic Docuvia1's own audit used successfully (`impact` was flagged there and shipped independently on both codebases):

1. **`docuvia doctor`** — now more valuable than when Docuvia1's audit first flagged it. `sync-knowledge` introduces new, currently-opaque failure modes (no-remote vs. offline vs. auth vs. lock-timeout all just log a warning today — see `KnowledgeGitService.reconcile()`'s `no-remote` catch-all). A `doctor` command that checks git availability, remote reachability, and whether the last `sync-knowledge`/`hydrate` succeeded would directly address this without new backend logic — everything it needs (`getRemoteUrl`, `getHeadSha`, `docuvia_meta`) already exists.
2. **`docuvia uninstall`** — unchanged gap from Docuvia1, but Docuvia2's `init` writes exactly the same 8+ files/hooks and still has no reverse. Cheap to build (the `<!-- docuvia:start/end -->` markers already make `CLAUDE.md` mechanically reversible per the prior audit's finding) and the risk of leaving stale hooks around only grows as `init` accumulates more agent-integration targets.
3. **Wire `sync-knowledge` into a schedulable/CI-friendly mode** — it's currently a fully manual command by design (this session's `SyncKnowledgeWorkflow` doc comment explains why it isn't auto-wired into the post-commit hook: it's a network operation and firing it on every commit would contradict the hook's "non-intrusive" promise). That reasoning is sound for the *hook*, but there's no first-class "run this on a timer / in CI after merge to main" story yet either — right now a team only gets reconciled knowledge if someone remembers to run the command. A low-effort follow-up: document (or provide) a CI snippet that runs `docuvia sync-knowledge` post-merge, since the command is already idempotent and safe to call repeatedly.
4. **Rename or flag the `init` fusion** (setup vs. index) — still an open, low-priority item carried over unchanged from the Docuvia1 audit. Worth revisiting only if a "just re-register my editor hooks without re-indexing" use case actually comes up.
5. **`docuvia check`** — a structural self-consistency check (dangling `node_links`, orphaned `l2_nodes.node_key`) would double as a regression guard for the Phase 0–3 storage work itself (e.g. would have caught a `bulkLoadGraph` referential-integrity bug immediately instead of via a targeted test). Medium priority, but now has a natural home: `HydrationService.hydrate()` already computes `edgesDropped` as a signal — `check` could simply surface that count plus a few more invariants (every `node_key` unique per project, every `l2_nodes.content_hash` non-null) as a standalone diagnostic.
6. **Not recommended**: chasing GitNexus's `trace`/`cypher`/concept-search/process-graph capabilities. Those require a fundamentally different data model (graph DB, execution-flow clustering) and duplicate what GitNexus already does well. Docuvia2's differentiated value is the git-native, versioned, team-shareable knowledge graph — the newly-completed `hydrate`/`sync-knowledge` round trip *is* that differentiation now actually working end-to-end. The better use of effort is hardening that (items 1–3 above) rather than competing with GitNexus on analysis depth.
