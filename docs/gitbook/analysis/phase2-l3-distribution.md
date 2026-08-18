# Phase 2, Item 1 — L3 Distribution Strategy (2026-07-21)

> **Input:** [Roadmap & Open Items](roadmap-and-open-items.md), Phase 2 item 1 ("L3 distribution
> strategy — highest priority, blocks the rest of Phase 2"). Decided and implemented in one pass
> via a context-gather → decision → implementation → verification pipeline (haiku ground-truth
> read of the current code → fable architectural ruling → sonnet implementation → independent
> re-verification). Numbering follows this project's `PREFIX-NNN` contract convention (see
> `phase1-decision-integration.md` for the precedent this format follows); prefix `L3DIST`.

---

## Problem

L3 nodes (AI-generated decisions) are accumulative and non-deterministic per developer, but
`KnowledgeGitService.mergeDivergedBranches` merges the whole knowledge branch with **Tree-Adoption**
(newest-source-commit-wins, whole-tree overwrite) — correct for L2 (deterministic, reverts with the
code) but wrong for L3 (a losing branch's independently-accumulated decisions get wiped, not
merged). Before this item, L3 durability rested entirely on `local.db` + remote `sync`; it never
rode the snapshot/knowledge branch at all.

## 1. Storage shape

**L3DIST-001 — Storage = Option C (independent cards), no modification.**
One card file per `content_hash` at `knowledge/_l3/<content_hash>.md` (full 64-char sha256 hex,
`.md` extension). Filename collision is impossible for non-identical content because the hash _is_
the identity; identical content legitimately collapses to the same card. Zero merge conflicts by
construction — the only property that matters once the merge strategy (§2) is decided.

**L3DIST-002 — Card body contains only fields that are immutable after creation.**
Frontmatter: `content_hash`, `node_type`, `title`, `l2_path`, `source_commits` (frozen at
first-insert value), `extraction_model`, `source_files`, `created_at`. Body: `content`. This is what
makes repeated snapshots byte-identical → same git blob SHA → true idempotency (§5b). Any field
that mutates on re-analysis must not be in the file.

**L3DIST-003 — `occurrence_count`, `last_verified_at`, and post-creation `source_commits` growth
stay local-DB-only and are never packed.** They are per-developer telemetry about how often a
decision was re-confirmed, not shared decision content; packing them would defeat L3DIST-002.

**L3DIST-004 — Linking is one-directional: L3 card → L2, via `l2_path` frontmatter field on the
card. No field is added to L2 markdown frontmatter.** `l2_path` stores the L2 node's markdown path
exactly as produced by `markdownPathFor()` in `snapshot-renderer.service.ts`, never the local
`l2_node_id` (an autoincrement SQLite PK, not portable across clones). This is an explicit deviation
from the roadmap's naive "hybrid C+B": embedding L3 references inside L2 frontmatter would make L2
files a function of accumulated AI decisions instead of a pure function of source code,
reintroducing on L2 the exact same "Tree-Adoption wipes a losing branch's independently-accumulated
content" bug this item exists to fix for L3 — just relocated. L2 must stay 100% deterministic from
source for Tree-Adoption to remain correct.

## 2. Merge strategy

**L3DIST-005 — Adopt SQLite bidirectional hydration recovery. `mergeDivergedBranches` /
Tree-Adoption is left completely untouched.** `_l3/` files ride along inside the same whole-tree
Tree-Adoption as everything else (`knowledge-git.service.ts`). No new merge orchestration, no
`git read-tree`/tree-splice/`mktree` logic was added.

**L3DIST-006 — Self-healing is a free side effect of SnapshotWorkflow already re-rendering the
_complete_ current `getAllExportable()` set on every run**, exactly as it already does for L2. When
Tree-Adoption picks the losing side's branch as winner and wipes a developer's L3 cards from the
knowledge-branch tree, that developer's `local.db` is untouched. Their very next `snapshot`/
`analyze` cycle re-emits every exportable card, including the ones that were wiped. No "check if
vanished from tree" logic is needed.

**L3DIST-007 — HydrateWorkflow (and `sync-knowledge`) gain a read of `knowledge/_l3/` and upsert
discovered cards into local `l3_nodes`**, providing the other half of the union (git → local.db)
for developers who never authored those decisions locally (fresh clone, or a teammate's decisions).
Required one new read-only provider primitive (`IGitProvider.listFilesAtRef`) since no existing
method listed tree entries — only single-file reads (`readFileAtRef`) existed before this change.

**Rejected: directory-level split merge** (a real 3-way merge / `read-tree` staging just for
`knowledge/_l3/`). It needs everything L3DIST-007 needs, _plus_ a genuine tree-splice (list both
parents' `_l3` entries, union them, `mktree` a new subtree, splice it into the winning top-level
tree, `commit-tree`) implemented as new custom logic living inside the locked
`mergeDivergedBranches` critical section. Since content-hash filenames make same-name-implies-
same-content structurally true, a "3-way merge" here is just a filename union — writing bespoke
tree-plumbing code to compute a union that a full-local.db re-render already gives for free is
disproportionate, matching this project's documented bias against reinventing mechanisms a simpler
path already covers (see PLAT-007's rejected alternatives for the same pattern applied elsewhere).

## 3. Wiring into existing verbs (no new CLI command)

- **`snapshot`** — after the existing L2 render, renders `l3NodesRepo.getAllExportable()` into
  `knowledge/_l3/<content_hash>.md` in the same tempDir before the existing pack call. No change to
  the packing call itself — it already packs the whole tempDir wholesale.
- **`hydrate`** (`HydrationService`) — after the existing `graph/nodes.jsonl`/`graph/edges.jsonl`
  restore, lists `knowledge/_l3/` at the resolved sha, reads each card, resolves `l2_path` →
  local `l2_node_id`, and upserts into `l3_nodes`.
- **`sync-knowledge`** — after `reconcile()` completes (still inside the existing lock scope,
  unchanged), invokes the same shared L3-import routine `hydrate` uses, so a developer who just
  fast-forwarded/merged the knowledge branch immediately absorbs any teammate's cards that survived
  Tree-Adoption, without waiting for a separate explicit `hydrate`.
- **`analyze`** — unaffected structurally; it already writes to `l3_nodes`. Its output simply
  becomes durable-on-branch the next time `snapshot` runs.

No new verb is introduced, per the project's no-new-commands convention.

## 4. Locking

**L3DIST-008 — The new write path needs no new lock acquisition; it inherits `KnowledgeBranchLock`
transitively.** Card rendering happens in the local tempDir before `packSnapshotToKnowledgeBranch`
is called, and that call already acquires the lock. The hydrate-side read (against an
already-resolved, immutable commit sha) needs no lock — reading a fixed, already-committed sha is
race-free by construction (git objects are immutable once written).

## 5. Edge cases — rulings

**(a) First-ever L3 write onto an empty/just-initialized knowledge branch.** No special case —
`ensureKnowledgeBranch` already starts from an empty tree; the first `snapshot` with any exportable
rows creates `knowledge/_l3/` as part of the normal wholesale directory pack, identically to how the
first L2 files get created.

**(b) Same developer re-running `analyze`/`snapshot` repeatedly — must be idempotent at the
git-object level.** Two layers cooperate: `upsertDecision` dedupes in `local.db` by `content_hash`
(pre-existing), and L3DIST-002/003 ensure the _rendered file_ for an unchanged row is byte-identical
run-over-run (no volatile fields in the card). Git's content-addressing therefore reuses the same
blob SHA — no new blob object, no spurious tree/commit churn attributable to L3.

**(c) `content_hash` collision across two different source files.** Possible today, not newly
introduced — `content_hash` has no `l2_node_id`/path component, and `upsertDecision`'s lookup
already joins only on `projectId` + `content_hash`, not `l2_node_id`. **Ruling: preserve that
semantics exactly.** One card, one `l2_path` — whichever L2 node's `upsertDecision` call inserted
the row first. Fixing cross-file collision precision, if ever needed, means changing what
`content_hash` is computed over — out of scope for this decision.

## 6. Rejected alternatives

- **Option A (centralized `graph/l3_nodes.jsonl` append)** — EOF-append conflicts under concurrent
  snapshots/Tree-Adoption, poor readability, no natural dedup story.
- **Option B in its literal form (L3 co-located in L2 frontmatter)** — rejected as storage; its
  _linking_ idea is kept but reversed (card → L2, not L2 → card), per L3DIST-004.
- **Directory-level split merge** — see §2; disproportionate versus L3DIST-005/006's reuse of the
  existing full-re-render pattern.

## Implementation

Shipped in one pass (2026-07-21):

- `lib/schema/src/sqlite/migrations/0005_l3_initial_source_commits.sql` — adds
  `l3_nodes.initial_source_commits` (additive `ALTER TABLE`, no backfill), required by L3DIST-002/
  003's frozen-at-insert rule.
- `lib/core/src/git/l3-card-renderer.ts` — `renderL3Card`/`parseL3Card` (fenced-JSON frontmatter —
  L3 titles/content are LLM text that can contain colons/newlines a `key: value` parser can't
  round-trip) and `computeL2GitPathsByNodeId`/`computeL2GitPathsByNodeKey` (posix restatement of
  `SnapshotRendererService`'s file/symbol path algorithm).
- `lib/core/src/git/l3-import.service.ts` — `importL3CardsFromKnowledgeBranch()`, the shared
  L3DIST-007 git→local.db routine used by both `hydrate` and `sync-knowledge`.
- `lib/git-local/src/libgit2-provider.ts` (+ `IGitProvider`) — new `listFilesAtRef()` via
  `git ls-tree --name-only <ref> -- <dir>/`.
- `lib/schema/src/sqlite/repos/l3-nodes-repo.ts` — `upsertDecision()` now freezes
  `initial_source_commits` on insert only; new `importCard()` (dedup-by-content_hash).
- `lib/ui-core/src/workflows/snapshot/snapshot-workflow.ts`,
  `lib/core/src/git/hydration.service.ts`,
  `lib/ui-core/src/workflows/sync-knowledge/sync-knowledge-workflow.ts` — wired per §3.

**Deviations from the literal contract** (both closest-faithful-equivalents, not violations):

1. `l2_path → l2_node_id` resolution reuses the existing `IGraphNodesRepo.findNodeIdByNodeKey`
   instead of adding a new "l2_nodes-by-path" SQL lookup — simpler, no new SQL surface.
2. `importL3CardsFromKnowledgeBranch` is a plain exported function from `@workspace/core`'s barrel
   rather than a new `IHydrationService` interface method — avoids forcing all 8 pre-existing
   `IHydrationService` mock literals across the codebase to grow a method they don't need.

**Verification (independent re-check, not the implementer's self-report):** `pnpm run build` green;
`lib/git-local` 40/40, `lib/schema` 45/45, `lib/core` 212/212, `lib/ui-core` 277/277,
`artifacts/cli` unit 113/113 + integration 23/23 (including both required real-git scenarios: a
fresh single-developer round trip, and a two-diverged-branches Tree-Adoption merge with confirmed
recovery of the losing side's card via its own next `sync-knowledge` + `snapshot`). ESLint clean.
One unflagged-but-reviewed addition: `sync-knowledge-workflow.ts` wraps its L3-import step in its
own `runUnderKnowledgeLock` acquisition after `syncKnowledgeBranch()`'s internal lock has already
been released — harmless (no deadlock risk), not required by L3DIST-008, kept as a documented extra
safety margin rather than rolled back.
