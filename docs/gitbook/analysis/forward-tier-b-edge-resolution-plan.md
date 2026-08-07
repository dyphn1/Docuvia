# Tier B Forward Edge Resolution Plan — replacing reverse `references` with AST-seeded call sites + LSP `textDocument/definition` (issue #11, plan A)

> **Input:** [issue #11](https://github.com/dyphn1/Docuvia/issues/11) (Tier B throughput collapse at repo
> scale), `typescript-cli-benchmark.md` / `csharp-cli-benchmark.md` findings. Reverse-query shape
> (`textDocument/references`, callee → find all callers) is the dominant cost; the C# report already
> concluded "queried backwards instead of forwards" is the root cause and recommended a two-phase
> forward resolver. This plan implements that direction across all nine LSP languages. Prefix `FWD`.

---

## Problem

Tier B (`--escalate-to-lsp`) resolves cross-file `calls` edges by, for **every symbol in every
file**, issuing a **project-wide reverse `textDocument/references`** (find all callers of this
callee). Measured against vscode (`typescript-cli-benchmark.md`): 12,339 files × ~24 symbols/file ≈
**~296k project-wide reverse searches**; one 120s batch resolves only 1,090 files. C# reproduced the
same shape and produced **0 edges in 30 min** (`csharp-cli-benchmark.md` finding #1).

The reverse shape is expensive twice over:

1. Each `references` forces the LSP server to **search the whole program** for one callee's usages
   (hub symbols like vscode's `Disposable` amplify super-linearly — 1,978 caller files → 1,978
   open+`documentSymbol` round-trips per symbol).
2. Each reference result forces opening the **caller** file on the fly (`resolveReferenceEdge` →
   `openAndGetSymbols`), thrashing the `maxOpenFiles` LRU and re-parsing re-opened files.

Pipelining per-file references (already shipped, `3bc58cba`) overlaps IPC round-trips but does not
reduce the server-side work: the reverse searches still happen.

## The forward shape

For each call site in a caller file, resolve its **callee** directly with `textDocument/definition`
(module resolution + symbol locate, **not** a project-wide reverse scan). The caller file is already
open (it is the file being processed), so no on-the-fly caller opens; the target file is opened once
and is usually itself a queue file, so it is cached.

Per-file request count (vscode ~24 symbols, ~equal call sites):

|                 | documentSymbol | reverse `references`    | caller opens          | definition               | target opens                |
| --------------- | -------------- | ----------------------- | --------------------- | ------------------------ | --------------------------- |
| today (reverse) | 1              | ~24 (project-wide each) | ~fan-out (LRU-thrash) | —                        | —                           |
| forward         | 1              | —                       | —                     | ~call-site-count (cheap) | ~distinct targets (≤ files) |

The reverse-to-forward flip turns ~296k expensive project-wide scans into ~296k cheap
module-resolutions, and removes the dynamic caller-open amplification entirely.

---

## Architecture decisions

**FWD-001 — Forward is the query shape; reverse stays as the fallback.** Per call site, resolve the
callee with `textDocument/definition`. Keep the existing reverse-`references` pipeline reachable
behind its current flag/registry and use it as the fallback when `definition` is unavailable,
ambiguous, or returns nothing for a language (`IMPT-002` honest-degradation: never invent an edge).
Do not delete the reverse code path in any slice.

**FWD-002 — Call-site positions come from Tier A's AST, not from LSP.** LSP has no native
"enumerate calls in this file" method (`documentSymbol` returns declarations, not call expressions;
`outgoingCalls`/call-hierarchy support varies by server). Tier A's `ast-worker.ts` already walks
every call node (`extractCalls`) — it just discards the positions. Extend it to persist each call's
source position + callee name + enclosing function, and seed Tier B's forward pass from those
positions. This is exactly the C# finding's "build a read-only project-symbol registry once from
existing L2 nodes, then per-file forward resolution".

**FWD-003 — Edge shape and node_key continuity are unchanged.** `ResolvedCallEdge` stays
`{ sourceNodeKey, targetNodeKey, source: "lsp" }`; both sides continue through
`resolveNodeKeyForFile` / `buildQualifiedBaseKey` / `buildUniqueNodeKey` (same file#name /
file#container.name / @Lline rules as Tier A). Source = the enclosing call-site symbol's key (reuse
`findDeepestContainingSymbol` at the call position, same containment gate as GRPH-006). Target = the
enclosing symbol of the `definition`'s resolved position in the callee file. The only new LSP
capability is `textDocument/definition` (LSP base spec; universally implemented).

**FWD-004 — Per-language gating via a new `LspLanguageConfig` field.** Add
`definitionResolution: "forward" | "reverse"` (default `"forward"` once a language's calibration
slice passes; TS/JS first). A language flips to forward only after its calibration fixture verifies
`definition` returns the expected symbol for a known call chain. This keeps every language honest
and reversible independently.

---

## Slices

### Slice 1 — Persist AST call-site positions (lib/core, lib/schema, lib/contracts)

- Extend `AstExtractionResult.calls` from `{ sourceFunction, targetFunction }` to also carry the
  call node's `startRow`/`startCol` (0-based, matching `node.startPosition`) and the callee token
  position. `ast-worker.ts` already has the nodes; this is a shape + persist change, no new parse.
- Persist call positions in the graph (edge-position column or a call-site row) behind
  `IGraphStore`/repo seam; migrate existing graphs (position column nullable, backfilled by next
  `analyze --full`).
- **Tests (integration, `lib/schema`):** a fixture file's persisted calls carry correct
  `startRow`/`startCol`; existing edges unchanged. **Tests (unit, `lib/core`):** `collectCallEdges`
  emits positions.

### Slice 2 — Forward resolver core (lib/core/src/lsp)

- Add `DEFINITION: "textDocument/definition"` to `LspMethods` (constants, not magic strings).
- New `resolveCalleeByDefinition(client, workspaceRoot, calleeUri, callPosition, ...)`:
  `definition` → `Location | Location[]` → for each result in-workspace: open target file
  (`openAndGetSymbols`, cached), `findDeepestContainingSymbol` at the definition position, node_key.
- New forward `processOneFile` variant: documentSymbol (1) → for each call site seeded by Slice 1:
  `definition` → target key → emit `{ source, target, "lsp" }`. Caller file never re-opened; target
  opens reuse the existing LRU cache.
- **Tests (unit, fake client):** definition returns a target location → correct edge keys (incl.
  GRPH-006 qualified targets); definition returns empty/out-of-workspace → file-level/`undefined`
  fallback exactly like today's `resolveReferenceEdge`; multi-location definition → first in-workspace
  wins, logged.

### Slice 3 — TS/JS flip + calibration (first language)

- Set `definitionResolution: "forward"` for `typescript`; reverse stays as fallback on any per-call
  definition failure.
- Live verification against `nestjs/nest` and `microsoft/vscode`:
  - **Parity:** Tier B edge count vs. the reverse baseline (nest ~17,811; vscode 1,184 in 120s).
    Forward must reach ≥ reverse edge count (it resolves the same call set) without inventing edges.
  - **Throughput:** vscode files processed in 120s (baseline 1,090) and total edges.
- **Tests (unit, real `typescript` install):** forward resolves a known cross-module call chain to the
  exact node_keys the reverse path produced.

### Slice 4 — Per-language `definition` calibration table + rollouts

For each of `python/go/rust/java/cpp/csharp/php/ruby`: run a calibration fixture (a known
call chain), record `definition` behavior, flip `definitionResolution` per language only when green.

| Language      | server                       | `definition` baseline expectation | notes                                                             |
| ------------- | ---------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| TypeScript/JS | `typescript-language-server` | reliable (module-resolution)      | flipped in Slice 3                                                |
| Python        | `pyright`                    | reliable                          | dynamic dispatch caveat                                           |
| Go            | `gopls`                      | reliable                          | `definition` returns decl for method values                       |
| Rust          | `rust-analyzer`              | reliable                          | traits/generics may return impl, not trait decl                   |
| Java          | `jdtls`                      | reliable                          | overloads → multiple results                                      |
| C/C++         | `clangd`                     | reliable                          | macros → decl-site not call-site                                  |
| C#            | `csharp-ls`                  | **calibrate hard**                | the 0-edges-in-30min language; may stay reverse or degrade to AST |
| PHP           | `intelephense`               | reliable                          | magic methods caveat                                              |
| Ruby          | `ruby-lsp`                   | reliable                          | metaprogramming caveat                                            |

Each language ships as its own small slice: fixture + flip + its own unit test, then a real-repo spot
check. Any language whose `definition` fails calibration stays on reverse (FWD-001 fallback) — no
language regression is acceptable.

### Slice 5 — Retire the reverse path (optional, after all flips)

- Once all nine languages pass calibration, gate the reverse pipeline off by default (keep code +
  constants + flags reachable). Update `IMPT-002`/`PLAT-007`, the roadmap item, and
  `typescript-cli-benchmark.md`/`csharp-cli-benchmark.md` with forward numbers; close issue #11.

---

## Relationship to K-way cross-file concurrency

Forward resolution removes the dynamic **caller**-open amplification (a hub symbol's 1,978 callers no
longer each trigger an open), so the `openFileCache` mutation surface shrinks to per-target opens
only. K-way concurrency over a shared cache is still not trivially safe (target opens mutate the same
LRU), but it is no longer required to reach the throughput target — do it, if at all, **after** Slice
3's measurement, as an independent optimization with its own test-contract updates.

## Risks & rollback

- **Edge parity regression** — every language flip is gated on a calibration fixture + real-repo
  spot check; the reverse path remains reachable and is the rollback for any flip.
- **`definition` position drift** — a multi-result or declaration-point `definition` could key the
  wrong target symbol. Mitigated by `findDeepestContainingSymbol` + GRPH-006 containment, same as
  reverse today, and by Slice 2's unit tests asserting qualified keys.
- **Schema migration** — Slice 1's position column is nullable and backfilled by `analyze --full`;
  `node-key-format-guard`-style version stamping covers format drift.
