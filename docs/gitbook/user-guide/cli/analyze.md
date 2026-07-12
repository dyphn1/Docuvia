# `docuvia analyze`

The `analyze` command is the core engine of Docuvia. It reads source code, parses the Abstract Syntax Tree (AST), extracts structural metadata, and stores the resulting L2 (Implementation) nodes and edges into the local SQLite database.

> **Note on Docuvia2:** Currently, `analyze` only performs AST parsing and structural extraction. The LLM-driven L3 (Domain Concept) extraction is deferred. If you attempt to invoke LLM extraction, it will output a "not supported yet" message.

## Usage

```bash
docuvia analyze [path]
```

### Arguments

- `[path]` *(Optional)*: The specific file or directory to analyze. If omitted, the wizard will prompt you or default to analyzing the entire workspace.

### Flags

- `--escalate-to-lsp`: *(Documented No-Op in Docuvia2)* Initially intended to trigger a headless Language Server Protocol (LSP) instance for deep references. Currently a no-op; falls back to AST static analysis.

## Under the Hood

When you run `docuvia analyze`:

1. **File Discovery**: The engine scans the target path, respecting `.gitignore` and `docuvia.config.json` exclude patterns.
2. **Checkout Thrashing Defense**: It calculates the Git Blob hash for each file. If the content hash matches a previously cached analysis in SQLite, it skips parsing.
3. **AST Parsing**: The Unified Isomorphic AST Microkernel parses the source into a normalized tree.
4. **Graph Persistence**: Nodes (functions, classes, exports) and Edges (calls, imports) are written to `local.db` as the Sole Source of Truth.
5. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/analyze.log`.

## Examples

Analyze the entire workspace:
```bash
docuvia analyze
```

Analyze a specific module:
```bash
docuvia analyze src/auth/
```
