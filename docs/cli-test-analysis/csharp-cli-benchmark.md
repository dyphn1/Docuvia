# C# CLI Benchmark & AST Analysis Report

**Test targets:**

- `PowerShell/PowerShell` — HEAD `6633089` (1,964 tracked files / 1,275 `.cs`)
- `dotnet/orleans` — HEAD `35e5381` (3,190 tracked files / 3,095 `.cs`)

**Subject under test:** Docuvia2 (Tier A local ingestion + Tier B LSP escalation via `csharp-ls`) vs. GitNexus, Graphify (structural/AST-only layer), Code-Review-Graph (CRG).

**Last updated:** 2026-07-29

---

## Methodology

- Chosen symbol per repo: `PSCmdlet` (PowerShell), `IGrain` (Orleans) — both foundational, heavily-referenced base types.
- Graphify's actual product surface (`query`/`impact`/`explain`/wiki/visual export, even the merged semantic graph) requires Claude Code itself to dispatch semantic-extraction subagents per its own `skill.md` — it has no standalone CLI for those. Only the structural/AST-only layer (`python -m graphify.extract`) was exercised here; the rest is marked N/A (not "pending" — it genuinely isn't a free-standing CLI capability).
- Out of scope: LLM-gated features (Docuvia2 L3 extraction, `gitnexus wiki`, semantic embeddings) and Remote Sync & Git Integration (no credentials configured) — not tested for any tool, either repo.
- Findings that turned out **not** to be C#-specific (general Docuvia2/GitNexus/Graphify/CRG behavior) have been moved to [`README.md`](./README.md) §4.

---

## 1. `PowerShell/PowerShell` Benchmark

### Indexing & Analysis

| Metric     | Docuvia2 | Docuvia2 (+LSP) | GitNexus | Graphify (AST-only) |     CRG |
| :--------- | -------: | :-------------- | -------: | ------------------: | ------: |
| Nodes      |   26,451 | not verified¹   |   40,211 |              22,318 |  22,370 |
| Edges      |   39,419 | not verified¹   |  124,114 |              44,334 | 122,020 |
| Build time |   22.7 s | —               |   63.2 s |              9.78 s |  25.2 s |

¹ Tier B was blocked on `csharp-ls` resolution during this pass; once fixed (see [Open Findings](#open-c-specific-findings)), the real re-test was run against Orleans, not PowerShell — see the Orleans table below.

### Query, Visualization & Impact

| Metric                    | Docuvia2 | GitNexus | Graphify |   CRG |
| :------------------------ | -------: | -------: | -------: | ----: |
| `query` time              |   0.80 s |    2.6 s |      N/A |     — |
| `impact` time             |   2.06 s |    2.4 s |      N/A | ~1 s¹ |
| `impact` — files          |        1 |        0 |        — | 4,668 |
| `export-topology` — links |     797² |      N/A |      N/A |     — |

¹ CRG: `impact --files` → 20 nodes directly changed, 500 shown within 2 hops of 4,668 total impacted, 184 additional files affected. `inheritors_of` → 173 results.
² Default `--collapse=auto` view, post-fix (`stats.foldedLinkCount` now reported) — see [README §4.1](./README.md#41-docuvia2). Full/`--collapse=symbol` count is 39,419 (matches raw edge count above).

- Docuvia2: `query`/`impact`/`explain` are all shallow single-edge results for this foundational symbol (Risk: MEDIUM) — a known single-hop-by-design limitation ([IMPT-001](../gitbook/adr/impact/IMPT-001-sql-single-hop-blast-radius.md)), not a bug.
- GitNexus: `query` returns loose BM25/FTS matches, not a precise symbol hit; `impact` returns 0 impacted (Risk: LOW) for the same foundational symbol — same shallow-by-default pattern as Docuvia2, different mechanism; `context` (2.5s) returns a rich method list but empty `incoming` (no callers/subclasses resolved).
- Graphify: N/A — requires Claude Code, not exercised.
- CRG: `wiki` → 24 pages, 192 KB, 3.3s. `visualize` → 43.1 MB HTML (loads `d3.v7.min.js` from a CDN, not fully offline).

---

## 2. `dotnet/orleans` Benchmark

### Indexing & Analysis

| Metric     | Docuvia2 | Docuvia2 (+LSP)  | GitNexus | Graphify (AST-only) |     CRG |
| :--------- | -------: | :--------------- | -------: | ------------------: | ------: |
| Nodes      |   47,703 | 0 edges applied¹ |   61,604 |              41,425 |  38,815 |
| Edges      |   55,287 | 0 edges applied¹ |  132,184 |              65,938 | 158,252 |
| Build time |   59.2 s | 30 min (capped)¹ |   68.2 s |              12.2 s |  36.3 s |

¹ Full re-test with all known Tier B execution blockers fixed — see [Open Findings](#open-c-specific-findings) #1. Real runs at both a 5-minute and a full 30-minute LSP timeout still produced 0 corrected edges.

### Query, Visualization & Impact

| Metric                    | Docuvia2 | GitNexus | Graphify |     CRG |
| :------------------------ | -------: | -------: | -------: | ------: |
| `query` time              |   0.99 s |    4.5 s |      N/A |       — |
| `impact` time             |   0.77 s |    2.3 s |      N/A | ~1.6 s¹ |
| `impact` — files          |        1 |       5² |        — |   1,675 |
| `export-topology` — links |       3³ |      N/A |      N/A |       — |

¹ CRG: `impact --files` → 7 direct, 500 shown within 2 hops of 1,675 total impacted, 453 additional files. `inheritors_of` → 57 results (e.g. `IRemindable`, `IGrainWithGuidCompoundKey`).
² GitNexus: `impact`/`context` on the bare name returned an ambiguous 2-candidate response (real interface vs. a generated API-surface stub); disambiguating with `-f` gave 5 direct implementors.
³ Default `--collapse=auto` view; not independently retested against Orleans after the PowerShell-verified fix described above. Full/`--collapse=symbol` count is 55,287 (matches raw edge count above).

- Docuvia2: same single-hop shallow-result pattern as PowerShell (Risk: MEDIUM).
- Graphify: N/A — requires Claude Code, not exercised.
- CRG: `wiki` → 72 pages, 704 KB, 1.35s. `visualize` → 45.9 MB HTML, 7.2s. `architecture` → 71 communities.

---

## Open C#-Specific Findings

1. **Full LSP is not a viable Tier B strategy for C#.** All 5 environment/execution blockers found while chasing this were fixed (`csharp-ls` PATH resolution, Orleans' `.slnx` marker-file recognition, Tier B queue population, per-request LSP timeout override with a new `--lsp-timeout` flag). Yet a real re-test against Orleans still produced **0 edges** at both a 5-minute and a full 30-minute timeout. Root cause, confirmed by direct comparison: not `csharp-ls` being slow (Visual Studio indexes the same repo in under 3 minutes) and not spawn-per-batch cold start (the whole queue is already one spawn) — it's the _query shape_: `textDocument/references` per method forces a whole-solution search, queried backwards (callee → find callers) instead of forwards. Deeper still, C#'s Tier A produces **~0 cross-file `calls` edges** to begin with (`ScopeResolver.resolveCall` only matches same-file locals/explicit imports; the name-fallback used elsewhere is deliberately disabled for C# to avoid false-matching common short method names) — so Tier B wasn't correcting existing edges, it was trying to create them from nothing via the most expensive mechanism available. **Recommendation**: drop full-LSP for C#'s Tier B; build a Docuvia-native, in-process resolver instead (a two-phase design — build a read-only project-symbol registry once from existing L2 nodes, then per-file forward resolution) — the same shape both GitNexus and CRG independently converged on for their own C# handling. Keep `csharp-ls`/`--escalate-to-lsp` reachable behind its existing flag; don't delete it. Cross-language version of this conclusion (no off-the-shelf system solves it better either): [README §4.6](./README.md#46-cross-language-symbol-resolution-is-a-full-lsp-or-any-off-the-shelf-system-the-right-approach-2026-07-29). **Not fixed** — this is an architecture-level recommendation, not a bug to patch.

---

## Session History

- **2026-07-24**: initial full pass — GitNexus's full structural matrix (both repos), Graphify's structural/AST-only layer (both repos), and a Docuvia2 re-run that captured previously-missing edge counts. Fixed the same-day: `query`'s incoming/outgoing edge-type labeling, `uninstall`'s incomplete cleanup, `export-topology`'s undersold default-collapse view (general Docuvia2 fixes, detail in [README §4.1](./README.md#41-docuvia2)), and Orleans' `.slnx` marker-file recognition (`f816706`).
- **2026-07-28/29**: chased Docuvia2's Tier B (`--escalate-to-lsp`) for C# — fixed 4 more execution blockers (`csharp-ls` PATH resolution, Tier B queue population `f5293b04`, per-request timeout override `29034173`) — then found, via a real re-test, that the remaining 0-edges result is an architecture-level gap, not a bug (see [Open Findings](#open-c-specific-findings) #1).

For full per-session detail, see this file's git history (`git log -- docs/cli-test-analysis/csharp-cli-benchmark.md`) and [`README.md`](./README.md) §3.1/§4 for the cross-tool findings extracted from these sessions.
