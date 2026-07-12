# `docuvia impact`

The `impact` command computes the "Blast Radius" of a specific target (a file, function, or class). It helps developers and AI agents understand what downstream components will be affected if the target is modified.

## Usage

```bash
docuvia impact <target>
```

### Arguments

- `<target>`: The name of the symbol or file path to analyze.

### Flags

- `--direction`: Specify `upstream` (callers/dependents) or `downstream` (callees/dependencies). Defaults to `upstream`.

## Under the Hood

When you run `docuvia impact`:

1. **SQL Single-Hop Blast Radius**: The query layer performs a fast 1-hop SQL JOIN across the `node_links` table in SQLite (`getIncomingEdges` / `getOutgoingEdges`).
2. **Risk Scoring**: Based on the number of connected nodes and their L1 tags, it assigns a risk level (e.g., `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
3. **Format Output**: The wizard UI formats the output into a color-coded table.
4. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/impact.log`.

*(Note: Multi-hop traversal and real-time WASM AST analysis for unsaved dirty buffers are currently deferred in Docuvia2).*

## Examples

Find what depends on a specific authentication function:
```bash
docuvia impact verifyToken --direction upstream
```
