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

- `--format=<human|json>`: Specify the output format. `human` (default) renders the blast-radius table and risk level; `json` emits the structured `ImpactResult` verbatim (`blastRadius`, `riskLevel`, optional `tierBCoverage`) as pure JSON on stdout with the banner/spinner suppressed. When the target doesn't resolve, `--format=json` prints the JSON literal `null` (exit `0`), so a consumer can distinguish "not found" from "found but zero dependents". An unknown value fails fast with a list of the available formats.

## Under the Hood

When you run `docuvia impact`:

1. **SQL Single-Hop Blast Radius**: The query layer performs a fast 1-hop SQL JOIN across the `node_links` table in SQLite (`getIncomingEdges` to find incoming dependents).
2. **Risk Scoring**: Based on the number of connected nodes and their L1 tags, it assigns a risk level (e.g., `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
3. **Format Output**: The wizard UI formats the output into a color-coded table.
4. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/impact.log`.

_(Note: Multi-hop traversal and real-time WASM AST analysis for unsaved dirty buffers are currently deferred in Docuvia2)._

### What counts as a dependency edge

`impact` only ever surfaces what Tier A (AST parsing) actually recorded as a `node_links` edge — a plain `import`/`require` on its own does **not** create an edge, only a genuine `calls`/`implements`/`extends` relationship (or a worker-spawn, see below) does. A file that imports another module but never calls/extends/implements anything from it will show as having no dependents, even though a real (if inert) coupling exists.

One dynamic-loading case is specifically handled: a TS/JS `new Worker(<path>)` call (Node's `worker_threads`) is detected and resolved the same way a relative import is — either from a literal string argument, or by tracing a same-file `path.resolve(__dirname, "<literal>")`/`path.join(__dirname, "<literal>")` assignment — and recorded as a `depends_on` edge. Other forms of dynamic loading (e.g. a plugin path built from a runtime variable, `import()` with a computed specifier, `child_process` spawning another project file) are **not** detected — cross-check those by symbol name (`docuvia impact <symbolName>`) or manual grep instead of trusting a "no dependents" result at face value.

## Examples

Find what depends on a specific authentication function:

```bash
docuvia impact verifyToken
```
