---
id: STOR-005
title: Symbol-Level Node Identity via Path-Keyed ID + Feature Hash
status: proposed
date: 2026-07-12
domains: [storage]
supersedes: []
superseded_by: []
---

# Symbol-Level Node Identity via Path-Keyed ID + Feature Hash

## Context

STOR-003 requires that `nodes.jsonl`/`edges.jsonl` produce clean, line-level git diffs, and STOR-001 requires that two developers' independently generated knowledge merge sensibly ("Latest Wins"). Both promises depend on the same precondition: **a node's id must be stable and deterministic** — the same symbol must serialize to the same id on every machine and every run, and an unrelated edit elsewhere in the codebase must not change it.

That precondition currently does not hold. `lib/core/src/graph/persist-ast-graph.ts` assigns node identity from `l2_nodes.id`, a SQLite `AUTOINCREMENT` rowid (`0001_init.sql`). Rowids are assigned in insertion order per-database; they are not derived from content and are not reproducible across machines or across a `clean` + re-`analyze` cycle on the same machine. Every JSONL export today is therefore, in effect, randomly relabeled — the "clean diff" and "sensible merge" promises are structurally unavailable regardless of the git-write-path fixes tracked elsewhere.

STOR-004 proposes git blob content-hashes as file identity, aimed at eliminating "checkout thrashing" re-analysis. It is necessary but not sufficient for node identity: `persist-ast-graph.ts` creates one `l2_nodes` row per **file** and one additional row per **function/class within that file** (all sharing the file's `pathPatterns`), so a single blob hash is shared by every symbol in a file — it cannot disambiguate `login()` from `logout()` in the same module. Worse, if node identity were naively derived from the blob hash, editing any one symbol changes the whole file's blob hash and would spuriously reassign new ids to every untouched sibling symbol in that file, defeating STOR-003's diff-cleanliness goal in the opposite direction from the rowid problem.

The AST layer already captures what's needed to solve this at the correct granularity: `ParsedAstFileData` (`lib/contracts/src/interfaces/ast.interfaces.ts`) records `startLine`/`endLine` for every parsed function and class. `l2_nodes.content_hash` (`0001_init.sql`) already exists as a column but is never populated — `persist-ast-graph.ts`'s `insertNode()` calls omit it entirely.

Separately, the AST worker (`lib/core/src/ast/ast-worker-pool.ts`) computes each file's hash via a plain `SHA256` over file content, not git's own blob hash (`sha1("blob " + size + "\0" + content)`). Git already computes and stores the latter for every tracked blob; recomputing an unrelated hash costs a full file read for no benefit STOR-004 doesn't already get for free via `git ls-tree` / `git hash-object` (the latter also works on untracked/dirty content, so this isn't limited to committed files).

## Decision

Node identity is split into three tiers, each solving a distinct granularity of the same problem:

1. **File blob hash (coarse gate).** Adopt git's native blob hash (not a separately computed SHA256) as the file-level change-detection key, per STOR-004. If a file's current blob hash matches the last-analyzed value cached against it, skip re-parsing that file entirely and reuse its existing node rows, ids, and content hashes unchanged. This is a zero-cost path whenever a file is untouched, which is the common case during a checkout or partial re-analyze.

2. **Path-keyed node id (identity).** Replace the exported/cross-machine node id with a deterministic value derived from position, not content: the file node's id is derived from its file path; a function/class node's id is derived from `<file_path>#<symbolName>`. The existing SQLite `AUTOINCREMENT` rowid may remain as an internal join key for query performance, but it must no longer be the value written to `nodes.jsonl`/`edges.jsonl` or referenced by L2↔L2 links across a hydrate/export cycle — a `node_key` (or equivalent deterministic column) carries the exported identity. This id survives any edit to the symbol's own body or to unrelated code elsewhere in the file; it only breaks under a rename, which is accepted as an inherent limit (git's own rename detection is heuristic, not exact, for the same reason).

3. **Symbol feature hash (content-hash).** Populate `l2_nodes.content_hash` from a hash of the symbol's own source slice (`source.slice(startLine, endLine)` using the already-captured AST ranges), computed only when tier 1's file-level gate indicates the file changed. Compare the new feature hash against the previously stored value for that node id: if unchanged, the symbol's row (and its id) is left untouched and produces zero JSONL diff lines even though its containing file's blob hash moved; only symbols whose own feature hash actually differs are treated as modified.

Net effect: a single-symbol edit inside a large file produces a one-line JSONL diff for that symbol and none for its siblings, satisfies STOR-003's diff-cleanliness requirement, and gives STOR-001's cross-developer merge a stable key space to reconcile against.

## Consequences

- **Positive**: Makes STOR-003's "clean line-level diff" claim actually true, and gives STOR-001's "Latest Wins" merge a meaningful key to merge on (today it would be merging on effectively-random rowids). Reuses git's own blob hash instead of a redundant SHA256 pass, at no extra cost. `l2_nodes.content_hash` — an existing but currently dead column — becomes load-bearing rather than being dropped or left unused.
- **Negative**: Renaming a symbol is indistinguishable from deleting the old id and creating a new one, which can orphan anything keyed to the old id. This is judged acceptable because GRPH-001's soft-pointer resolution (AST paths/symbol names re-resolved dynamically, not hard foreign keys) already has to tolerate this class of drift for L3↔L2 linking. Introducing a `node_key`/id-mapping column is a schema and `persist-ast-graph.ts` change, not purely additive — existing local databases need a migration or a full `clean` + re-`analyze` to backfill it.
- **Rejected alternative**: using the file blob hash directly as (or as an input to) the node id — rejected because it is shared by every symbol in a file and churns every sibling's id on any single-symbol edit, which is the failure mode this ADR exists to avoid.
