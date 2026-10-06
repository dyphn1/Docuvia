# `docuvia impact`

The `impact` command computes the "Blast Radius" of a specific target (a file, function, or class). It helps developers and AI agents understand what downstream components (upstream callers / dependents) will be affected if the target is modified.

## Usage

```bash
docuvia impact <target>
```

## Options

### Arguments

- `<target>`: The name of the symbol or file path to analyze.

### Flags

- `--format=<human|json>`: Specify the output format. `human` (default) renders the blast-radius table and risk level; `json` emits the structured `ImpactResult` verbatim (`blastRadius`, `riskLevel`, optional `epistemic`/`riskNote`/`dynamicEvidence`/`dynamicEvidenceUnavailable`/`tierBCoverage`/`coverageNote`) as pure JSON on stdout with the banner/spinner suppressed. When the target doesn't resolve, `--format=json` prints the JSON literal `null` (exit `0`), so a consumer can distinguish "not found" from "found but zero dependents". An unknown value fails fast with a list of the available formats.
- `--explain-resolution`: Include complete per-call-site resolver, verification, dependency, and candidate evidence on call edges. By default, call edges expose a bounded certainty summary; MCP impact accepts the equivalent `explainResolution: true` detail parameter.

## Empty results are UNKNOWN, not zero (issue #192)

An empty blast radius is reported as `Risk level: UNKNOWN` — never `LOW`. For a symbol target the table always lists the symbol's own containing file (IMPT-001); that context row is not a dependent, so a symbol whose only entry is its own file is treated as empty too (issue #508) — `UNKNOWN`, lower-bound — while the risk band of a symbol with real dependents is unchanged. Absence of static edges is **not** evidence that no code depends on the target: the edge graph only models `calls`/`implements`/`extends` (+ worker spawns), so runtime-variable imports, computed `import()` specifiers, and `child_process` spawns produce no edge no matter how complete ingestion was. Every non-exact result carries an `epistemic: "lower-bound"` flag plus a human-readable `riskNote` explaining which coverage gap applies:

- **Partial Tier B ingestion** — "only N of M workspace files have been analyzed"; re-run `docuvia analyze --escalate-to-lsp --full`.
- **Registry-mediated dependents** (issue #136) — the target's own file resolves dependencies through the `docuviaFactory`/`TOKENS` registry.
- **Static-edges-only caveat** — full coverage, but dynamic-loading patterns remain invisible by design.
- **Runtime dependency evidence** (issue #393) — a TS/JS `import(expr)` could load the target. The records are listed in `dynamicEvidence`; a statically bounded candidate loader also appears as a `dynamic-candidate` entry, which never counts toward the risk band.
- **Runtime dependency evidence unavailable** (issue #508) — the persisted `import()` evidence could not be trusted, so no runtime boundary was checked. `dynamicEvidenceUnavailable: { "reason": ... }` names why: `corrupt-json` or `not-array` (the stored payload is damaged or from another schema), `invalid-record` (one record is malformed — the whole set is then untrusted, never partially used), `missing` (JS/TS sources are tracked but the evidence was never computed for this database, e.g. after `snapshot` → `clean` → auto-hydrate, whose knowledge branch does not carry it), or `incomplete-scan` (a tracked source existed but could not be read, or resolved outside the workspace root, during ingestion). `docuvia analyze --force` rebuilds it; any ingestion batch that meets an unavailable set rescans every tracked JS/TS source instead of trusting a partial set. Deleted tracked paths are skipped and do not keep evidence unavailable.

Runtime `import()` evidence is recomputed against the **current** file universe on every ingestion batch, not only for the loader files that batch re-parsed (issue #508): adding a plugin file next to an unchanged loader makes it a candidate immediately, and growing a pattern past 64 candidates moves it to the `candidate-set-exceeds-64` overflow state (never a stale bounded set).

Specifiers written with the NodeNext/ESM runtime extension match their sources: ``import(`./plugins/${name}.js`)`` bounds `plugins/*.ts`/`.tsx`/`.js`/`.jsx`, `.mjs` bounds `.mts`/`.mjs`, and `.cjs` bounds `.cts`/`.cjs` — in both template and literal specifiers (issue #508).

A non-empty blast radius at full Tier B coverage, with no target-relevant runtime dependency evidence and an available evidence set, omits `epistemic` entirely (omit-when-confident). Accuracy against human-labeled ground truth is measured weekly in CI by the eval workflow (`.github/workflows/eval.yml`) over `artifacts/cli/test/support/impact-corpus.ts`; run it locally with `pnpm run eval:impact`.

Call-edge certainty is reported separately in `callResolutionBreakdown`: `verifiedProven`, `heuristicProvisional`, and `unknown` count the respective call contributions. Each blast-radius entry retains its per-site `callResolutions`. Existing `edgeSource` values continue to describe edge origin, such as `lsp-fallback` and `dynamic-candidate`; certainty remains explicit in the call-resolution summary and the separate counts. The existing `riskLevel` calculation remains based on the full reported radius, with these certainty counts shown alongside it.

## The call-site fallback (`edgeSource: "lsp-fallback"`, issue #217)

When a target has **no real caller edge** — nothing pointing at it except its own file's `contains` link — the static edge graph alone is exactly where ScopeResolver's blind spots live (receiver calls on untyped values, dynamically-loaded modules). On that path, `impact` additionally reverse-reads the raw `ast_call_sites` seed table for call sites naming the target symbol, and maps each calling file back to its module node:

- Fallback entries carry `"edgeSource": "lsp-fallback"` in `--format=json`, and the human-readable table grows a **Source** column marking them `lsp-fallback` (static rows read `static`). A fully-static result keeps the old two-column table.
- Semantics are deliberately weaker than a static edge: _"a call to this name exists in this file"_ — not _"this exact definition is imported here"_. Same-named methods on unrelated receivers can produce false-positive candidates; treat fallback entries as leads to verify, not confirmed edges. The Phase 2 test `lsp-fallback recovery is labeled lsp-fallback, never static (E6, E7 provenance)` pins this channel distinction.
- **What this covers today**: a call written as a **bare identifier** — `evalPlainHelper()` — or a receiver/method call such as `svc.method()` or typed `obj.method()` when the reverse lookup recovers the target name. These callers are surfaced as `edgeSource: "lsp-fallback"` candidates. The Phase 6 test `recovers unresolved receiver and typed method calls through the shipped impact fallback` asserts receiver and method recovery; the Phase 2 E6 test `lsp-fallback recovery is labeled lsp-fallback, never static (E6, E7 provenance)` asserts the recovered receiver prediction's channel.
- **Call-site fallback limit**: dynamic-loading forms whose call sites do not name the dependency target are not recovered by this fallback. Bounded runtime evidence and statically resolved dependencies cover some of those cases, as described below.
- The defining file calling its own symbol (recursion) is excluded, files already visible via static edges are never double-counted (the risk score reads the entry count directly), and the reverse read only runs when the static path found no real callers — an all-callers result pays zero extra latency.
- The fallback is backed by a dedicated `(project_id, target_function)` index (`0011_ast_call_sites_target_idx.sql`), keeping the lookup fast at vscode-scale graphs.

## Under the Hood

When you run `docuvia impact`:

1. **SQL Single-Hop Blast Radius**: The query layer performs a fast 1-hop SQL JOIN across the `node_links` table in SQLite (`getIncomingEdges` to find incoming dependents).
2. **Call-site fallback** (issue #217): only when step 1 found no real caller edges, a reverse read of `ast_call_sites` recovers dependents whose resolution failed at ingestion time, each labeled `edgeSource: "lsp-fallback"`.
3. **Risk Scoring**: Based on the number of connected nodes and their L1 tags, it assigns a risk level (e.g., `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
4. **Format Output**: The wizard UI formats the output into a color-coded table.
5. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/impact.log`.

_(Note: Multi-hop traversal and real-time WASM AST analysis for unsaved dirty buffers are currently deferred in Docuvia2)._

### What counts as a dependency edge

`impact` primarily surfaces what Tier A (AST parsing) recorded as a `node_links` edge — a genuine `calls`/`implements`/`extends` relationship, a worker-spawn (see below), or a use of an imported value. Reading an imported binding counts: `src/client.ts` importing `EVAL_MAX_RETRIES` from `./config` and only reading it is reported as a dependent (the Phase 6 `plain-import-no-call` case, asserted by `fixes the statically decidable legacy gaps without removing them from the corpus`). Only this value-use form is covered by the eval corpus; do not read an empty result for an import whose binding is never used as proof that no coupling exists.

One dynamic-loading case is specifically resolved at ingestion time: a TS/JS `new Worker(<path>)` call (Node's `worker_threads`) is detected and resolved the same way a relative import is — either from a literal string argument, or by tracing a same-file `path.resolve(__dirname, "<literal>")`/`path.join(__dirname, "<literal>")` assignment — and recorded as a `depends_on` edge.

The call-site fallback does not recover dynamic-loading forms whose call sites do not name the target. Other paths now cover the Phase 6 cases:

- A plugin path built from a runtime variable and an `import()` with a computed specifier are surfaced through bounded #393 `dynamicEvidence` as `dynamic-candidate` entries. They remain candidates rather than exact static edges and do not count toward the risk band. The Phase 6 test `recovers bounded runtime import candidates without sacrificing precision (#393)` asserts precision, recall, and F1 of 1 for both scenarios; `surfaces bounded evidence and candidate caller through the shipped impact command (#393)` asserts the bounded evidence and `dynamic-candidate` JSON entry for the runtime-variable case.
- A `child_process` spawn of another project file is statically decidable and now recovered. The Phase 6 test `fixes the statically decidable legacy gaps without removing them from the corpus` asserts precision, recall, and F1 of 1 for the `child-process-spawn` case.

These results come from bounded runtime evidence or static dependency resolution, not from the call-site fallback. The fallback remains limited to named call sites, as described in [the call-site fallback](#the-call-site-fallback-edgesource-lsp-fallback-issue-217).

An empty result does now mean "no static edge _and_ no same-named call site anywhere", which is a stronger zero than before — but it still carries the issue #192 `UNKNOWN`/lower-bound caveats rather than presenting itself as a confident answer.

## Examples

Find what depends on a specific authentication function:

```bash
docuvia impact verifyToken
```
