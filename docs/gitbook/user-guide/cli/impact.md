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

- `--format=<human|json>`: Specify the output format. `human` (default) renders the blast-radius table and risk level; `json` emits the structured `ImpactResult` verbatim (`blastRadius`, `riskLevel`, optional `epistemic`/`riskNote`/`tierBCoverage`/`coverageNote`) as pure JSON on stdout with the banner/spinner suppressed. When the target doesn't resolve, `--format=json` prints the JSON literal `null` (exit `0`), so a consumer can distinguish "not found" from "found but zero dependents". An unknown value fails fast with a list of the available formats.

## Empty results are UNKNOWN, not zero (issue #192)

An empty blast radius is reported as `Risk level: UNKNOWN` — never `LOW`. Absence of static edges is **not** evidence that no code depends on the target: the edge graph only models `calls`/`implements`/`extends` (+ worker spawns), so runtime-variable imports, computed `import()` specifiers, and `child_process` spawns produce no edge no matter how complete ingestion was. Every non-exact result carries an `epistemic: "lower-bound"` flag plus a human-readable `riskNote` explaining which coverage gap applies:

- **Partial Tier B ingestion** — "only N of M workspace files have been analyzed"; re-run `docuvia analyze --escalate-to-lsp --full`.
- **Registry-mediated dependents** (issue #136) — the target's own file resolves dependencies through the `docuviaFactory`/`TOKENS` registry.
- **Static-edges-only caveat** — full coverage, but dynamic-loading patterns remain invisible by design.

A non-empty blast radius at full Tier B coverage omits `epistemic` entirely (omit-when-confident). Accuracy against human-labeled ground truth is measured weekly in CI by the eval workflow (`.github/workflows/eval.yml`) over `artifacts/cli/test/support/impact-corpus.ts`; run it locally with `pnpm run eval:impact`.

## The call-site fallback (`edgeSource: "lsp-fallback"`, issue #217)

When a target has **no real caller edge** — nothing pointing at it except its own file's `contains` link — the static edge graph alone is exactly where ScopeResolver's blind spots live (receiver calls on untyped values, dynamically-loaded modules). On that path, `impact` additionally reverse-reads the raw `ast_call_sites` seed table for call sites naming the target symbol, and maps each calling file back to its module node:

- Fallback entries carry `"edgeSource": "lsp-fallback"` in `--format=json`, and the human-readable table grows a **Source** column marking them `lsp-fallback` (static rows read `static`). A fully-static result keeps the old two-column table.
- Semantics are deliberately weaker than a static edge: _"a call to this name exists in this file"_ — not _"this exact definition is imported here"_. Same-named symbols can produce false positives; treat fallback entries as leads to verify, not confirmed edges.
- **What this covers today**: a call written as a **bare identifier** — `evalPlainHelper()` — whose definition the static resolver could not link (an import path it cannot resolve, or a symbol reached with no import at all). Verified end-to-end: such a caller comes back as an `lsp-fallback` entry.
- **Known gap — method/receiver calls are NOT recovered today.** Tier A stores a member-expression call site under its full dotted text (`engine.evalRenderTemplate`, and likewise `console.log`, `JSON.parse`), while the reverse lookup matches the target node's **bare** name (`evalRenderTemplate`) with an exact `IN (...)` comparison. The two never meet, so `impact evalRenderTemplate` does not surface `render-host.ts`. This is the `unresolved-receiver-call` case in the eval corpus, currently scoring 0.000 — it is there to keep the gap visible until it is closed.
- **What it does not cover at all**: the dynamic-loading blind spots below. They never name the target at a call site, so no row exists to look up — see [What counts as a dependency edge](#what-counts-as-a-dependency-edge).
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

`impact` primarily surfaces what Tier A (AST parsing) recorded as a `node_links` edge — a plain `import`/`require` on its own does **not** create an edge, only a genuine `calls`/`implements`/`extends` relationship (or a worker-spawn, see below) does. A file that imports another module but never calls/extends/implements anything from it will show as having no static dependents, even though a real (if inert) coupling exists.

One dynamic-loading case is specifically resolved at ingestion time: a TS/JS `new Worker(<path>)` call (Node's `worker_threads`) is detected and resolved the same way a relative import is — either from a literal string argument, or by tracing a same-file `path.resolve(__dirname, "<literal>")`/`path.join(__dirname, "<literal>")` assignment — and recorded as a `depends_on` edge.

The remaining forms (a plugin path built from a runtime variable, `import()` with a computed specifier, `child_process` spawning another project file) still cannot be resolved into exact edges — **and the call-site fallback does not recover them either.** All three measure 0.000 precision/recall in the eval corpus, and the reason is structural rather than a missing feature: `ast_call_sites` is keyed by the _name being called_, and none of these forms ever names the target at a call site — they go through `(mod as { default: () => unknown }).default()`, a bare property read (`mod.EVAL_EN_MESSAGES`), or a path string in an `execFile("node", [...])` argument. There is no row for the reverse lookup to find. What the fallback does recover is a different gap — see [the call-site fallback](#the-call-site-fallback-edgesource-lsp-fallback-issue-217) above.

An empty result does now mean "no static edge _and_ no same-named call site anywhere", which is a stronger zero than before — but it still carries the issue #192 `UNKNOWN`/lower-bound caveats rather than presenting itself as a confident answer.

## Examples

Find what depends on a specific authentication function:

```bash
docuvia impact verifyToken
```
