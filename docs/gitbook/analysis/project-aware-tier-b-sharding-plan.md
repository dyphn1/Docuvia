# Project-Aware + Dependency-Ordered Tier B Sharding Plan (issue #11 follow-on)

> **Status: shipped 2026-08-15 (issue #41).** Slices 1-3 implemented + tested; Slice 4 acceptance
> measured on tauri (see [Implementation findings](#implementation-findings-measured-on-tauri-10-cores--16-gb)
> below and roadmap item 36). PRJ-001..007 all implemented.

> **Input:** the throughput finding that one per-language LSP batch (single server pointed at the
> repo root, round-robin sharding) still times out at the 120s default even for mid-size repos
> (tauri 325 rust files ~90s incl. settle; gin 98 go files ~128s; nest reverse never completes).
> `typescript-cli-benchmark.md` §4/§5 already proved the throughput lever is _process_ sharding, not
> in-process K-way (K=4 ~12%, 4-process ~10x). This plan replaces the naive round-robin partition
> with **project-aware, dependency-ordered** sharding so each LSP server is scoped to one project's
> files and pointed at that project's root. Prefix `PRJ`.

---

## Problem

Tier B (`--escalate-to-lsp`) currently:

1. **Loads the whole workspace per server.** One language bucket → one provider → one server spawned
   with `cwd`/`workspaceFolder = workspaceRoot` (`lsp-edge-provider-base.ts` `initializeSession`:
   `rootUri = workspaceRoot`, single workspace folder). For a Cargo workspace / solution / go-module
   monorepo that means every server builds the _entire_ project's symbol graph, even when it only
   touches one crate's files.
2. **Round-robins shards** (`partitionRequest`, `lsp-edge-provider-base.ts:542-562`: `i % processCount`).
   Files of the same project are scattered across every shard, so _each_ shard server still loads the
   whole workspace. Sharding then multiplies whole-workspace memory by the shard count and makes every
   server redundantly index the same graph — overlapping compute and OOM pressure (concern: avoid too
   large CPU/memory).
3. **Ignores project dependency order.** Files are processed in queue order, not bottom-up. When a
   caller edge is applied and its callee lives in a not-yet-processed project, the callee node isn't
   persisted yet, so `findNodeIdByNodeKey` returns `undefined` and the edge is **silently dropped**.
   Resolving dependencies first closes that gap and keeps forward `definition` targets warm.
4. **Bounded only by memory + file count, not CPU** (`effectiveProcesses`: `min(requested,
fileCount, memoryBounded)` — no `os.availableParallelism()` cap), and the whole-batch 120s deadline
   counts the cold-start settle against it (`deadlineAt` is set before `settleColdStart`).

**Project-awareness is also only half-done upstream.** Tier A (`persist-ast-graph` / `ast-worker`)
persists nodes/edges per _file_ and never records the owning project boundary, so nothing downstream
can group by project. This plan's Slice 1 records that boundary at the batch level (it does not need a
schema change — the owning project is derivable from the file path + project markers on demand).

---

## Architecture decisions

**PRJ-001 — Partition by owning project, not round-robin.**
For each queued file in a language bucket, find its owning project = the nearest ancestor directory
containing the language's project marker (`Cargo.toml`, `go.mod`, `.sln`/`.slnx`/`.csproj`,
`package.json`+`tsconfig`, `pyproject.toml`, `pom.xml`, … — the same markers the per-language
`*-lsp-preflight` already recognizes). Group the bucket into projects; each project is one shard unit
(files stay together). Replaces `partitionRequest`'s `i % processCount` so one server owns one
project's files instead of every server owning a scattered slice of the whole workspace.

**PRJ-002 — One server per project, pointed at the project root.**
A shard's server is initialized with `cwd`/`workspaceFolder` = the _project root_ (not the repo root),
so it loads only that project plus its direct path dependencies. This is what actually cuts per-server
memory and warm-up time and localizes `references`/`definition` to the project. Requires
`EdgeResolutionRequest` to carry a per-shard root and `initializeSession` to honor it (falls back to
`workspaceRoot` for files with no owning project).

**PRJ-003 — Process projects in dependency order (bottom-up).**
Build a project dependency graph from the project files (`Cargo.toml` `[dependencies]`/`[workspace]`
`path`/`workspace = true`, `go.mod` local `require`, `.csproj` `<ProjectReference>`,
`package.json`/`tsconfig` project refs/workspaces). Process projects in topological order —
dependency/leaf projects first. Two concrete wins:

1. **No silent caller-edge drops.** Edge application (`run-tier-b-batch.ts` `applyResolvedEdges`) skips
   an edge whose `findNodeIdByNodeKey` misses. Processing callee projects first guarantees callee nodes
   are persisted before the dependent project's caller edges are applied, so the edge lands.
2. **Forward-resolution locality.** A dependent project's `textDocument/definition` resolves into
   already-processed (persisted, warm) dependency projects.

Cycles are broken deterministically (order by path as a tiebreak) so the sort always terminates.

**PRJ-004 — Parallelism bounded by cores _and_ memory.**
Add a CPU cap to `effectiveProcesses`: `min(requested, fileCount, availableParallelism(), memoryBounded)`.
With `PRJ-002` scoping each server to a project, the per-server memory estimate (`processMemoryEstimateMb`)
becomes realistic again; default `maxProcesses` auto-derives `min(cores, floor(0.25×RAM / estimate))`
instead of the hard `1`, so a default run already parallelizes without an explicit `--lsp-processes`.

**PRJ-005 — Per-project deadline; settle outside the deadline.**
Give each project's batch a deadline sized to its own file count (a shared budget drawn as projects
are scheduled), instead of one whole-batch 120s that trips on the tail. Move `settleColdStart` outside
the deadline window (`deadlineAt` is currently computed before the settle) so warm-up doesn't eat a
project's processing budget. This removes the need to pass `--lsp-timeout=0` for mid-size repos.

**PRJ-006 — Coalesce sub-threshold projects.**
Many small projects = many servers = many cold-start settles (rust 8s each). Run projects concurrently
(bounded by PRJ-004) to amortize settle across cores, and coalesce sub-threshold projects (e.g. fewer
than a configurable floor of files, default 1-2) into one shared "misc" shard at the repo root so tiny
projects don't each pay a full spawn + settle. This is the deliberate tension between localization
(PRJ-002) and warm-up cost — resolved by the threshold, not by always one-server-per-project.

**PRJ-007 — Readiness poll after the settle.**
Parallel cold servers all load the same big workspace at once, and the first files can process before
any server's crate graph is ready — a sharded tauri run's whole 323-file rust bucket returned _zero_
references (everything empty post-settle) because the batch finished during the load. After the fixed
settle, poll a probe `textDocument/references` (burst every call-site symbol of the first symbol-bearing
files) until any symbol returns a reference, or the cap trips (default poll 5s / cap 120s; contracts
`coldStartPollMs` / `coldStartMaxWaitMs`). Only engages for languages that opted into cold-start
awareness (`coldStartSettleMs > 0` — rust, TS); fast-loading servers (clangd) skip the poll. The probe
must scan _past_ the first symbol-bearing file (its symbols may legitimately have no callers — e.g. a
bench binary's `main`), and a shard whose first files are symbol-less but is _larger_ than the probe
window is NOT ready (a cold server returns empty `documentSymbol` for everything — measured on tauri's
misc rust shard); only a genuinely tiny shard (every file inspected) is treated as ready so it doesn't
stall the batch.

---

## Implementation findings (measured on tauri, 10 cores / 16 GB)

- **rust-analyzer ignores `cwd`/`rootUri` scoping — it loads the _whole_ Cargo workspace from any
  member directory** (`cargo metadata` from a crate dir returns all members). Measured ~4.3 GB RSS from
  both the workspace root and `crates/tauri-cli`; per-project `serverRoot` therefore does **not** reduce
  rust load, and `N` rust shards ≈ `N × whole-workspace` memory. PRJ-002's memory premise holds for
  project-scoped servers (TS: each project-rooted tsserver loads its own tsconfig project), not for
  module-based rust servers.
- **Auto `maxProcesses` is memory-bounded via `processMemoryEstimateMb`** (per-language config, default
  512 MiB, rust 2048 MiB). On this box: rust → 2 shards, TS → 8 shards. 8 whole-workspace rust servers
  (~34 GB) thrashed 16 GB and crawled (>20 min); 2 shards are stable and fast.
- **The CLI previously hard-coded `--lsp-processes` default to 1** (`analyze.ts` `?? 1`), so every
  real-world run silently used the single-process path and §4 never engaged. Removed — unset now
  auto-derives per PRJ-004.
- **Edge-set parity:** single-process output is _bit-exact run-to-run_ (same 4662 edges / same SHA-256
  hash three times). Sharded output (4772 ± ~10) is a **superset**: +110 edges (mostly TS — per-project
  servers resolve their project's internal references that the repo-root single server missed) minus 2-3
  edges lost to `ContentModified` (`-32801`) races when a server re-opens a file mid-flight — pre-existing
  batch behavior (the single-process run loses a _different_ file, `tauri-build/src/acl.rs`,
  deterministically), not a sharding regression.
- **Throughput (final re-measurement, 2026-08-15, saturated graph):** sharded **1:49 wall / 4772 provider
  edges** vs `--lsp-processes=1` **1:59 wall / 4662 provider edges** (both applied 0 corrected edges —
  idempotent dedup on an already-saturated graph). Across runs: sharded 95-109 s, single 113-119 s
  (~8-16% faster). The misc shard (coalesced remainder, 222 files) is the bottleneck — rust parallelism
  is hard-capped by RAM on this box; on larger machines the design scales (more rust shards → bigger
  win).

---

## Slices

### Slice 1 — Project enumeration + dependency ordering (`lib/core/src/lsp` or `lib/core/src/project`)

- New pure module: given a language bucket's file list + workspace root, return ordered project
  groups. Each group = `{ root: string, files: string[], deps: string[] }`.
- Owning-project lookup: walk ancestors from each file up to workspace root, stop at the first dir
  containing the language's marker. Cache per-directory so a shared project dir is resolved once.
- Dependency graph: parse the project markers per language (Cargo/go/cs/ts), build edges, topologically
  sort with path tiebreak on cycles.
- **Tests (unit, `lib/core`):** files group to the correct owning project (incl. nested crates, files
  at repo root with no marker → `workspaceRoot`); dependency order is bottom-up; a cycle terminates
  deterministically; sub-threshold coalescing produces a misc shard.

### Slice 2 — Project-aware partition + per-project server root (`lib/core/src/lsp`, `lib/contracts`)

- Replace `partitionRequest`'s round-robin with the Slice 1 project groups (passed in via
  `EdgeResolutionRequest` or built by the orchestrator and fed to the provider).
- Extend `EdgeResolutionRequest` (contracts) with the per-shard project root; `initializeSession`
  uses it for `cwd`/`rootUri`/`workspaceFolder`, falling back to `workspaceRoot`.
- **Tests:** process-invariance holds (same edges/filesProcessed/filesFailed as single-process);
  a shard initializes against its project root, not the repo root.

### Slice 3 — Bounds + deadline (`lib/core/src/lsp`, `lib/ui-core`)

- Add `os.availableParallelism()` to `effectiveProcesses`; auto-default `maxProcesses` when unset.
- Move `settleColdStart` outside the deadline window; per-project deadline accounting in
  `resolveEdgesForLanguageBuckets` / `run-tier-b-batch`.
- **Tests:** shard count clamped by cores and by memory; settle no longer counts against a project's
  deadline.

### Slice 4 — Rollout + re-measurement

> **Done 2026-08-15** — see the [Implementation findings](#implementation-findings-measured-on-tauri-10-cores--16-gb)
> section above. The broader benchmark matrix (ripgrep/go/csharp/nest) is still open work: run the
> sharded build against those repos and update `rust-cli-benchmark.md` / `go-cli-benchmark.md` /
> `typescript-cli-benchmark.md` throughput rows; reconcile with
> `forward-tier-b-edge-resolution-plan.md` (forward + sharding compose — orthogonal).

---

## Risks & rollback

- **Per-file parity** — each file stays in exactly one project/shard, and node_keys are per-file
  deterministic, so merging ordered shard outcomes reproduces a single-process run from the same
  starting state. The process-invariance test guards this.
- **Marker/project inference drift** — a file mis-ownered to the wrong project root breaks its
  server's resolution. Mitigation: fall back to `workspaceRoot` on any parse failure (never invent a
  project), and the unit tests pin known marker shapes.
- **Warm-up regression for many small projects** — bounded by PRJ-006's coalescing; keep
  one-server-at-repo-root as the escape hatch (reverse `--lsp-processes=1`).
- **Dependency-graph parse cost** — markers are small TOML/XML/JSON files read once per batch; the
  parse is unit-tested and cheap relative to the LSP requests it gates.
