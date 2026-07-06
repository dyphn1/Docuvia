# docuvia-analyze(1)

## NAME

docuvia-analyze - Parse the repository and construct the AST knowledge graph

## SYNOPSIS

`docuvia analyze [--deep]`

## DESCRIPTION

The `docuvia analyze` command is the core ingestion engine. It traverses the current workspace, processes supported source code files using Tree-sitter, and populates the local index database (`.docuvia/local.db`) with an Abstract Syntax Tree (AST) graph.

The command maps spatial relationships (e.g., function definitions, method calls, cross-file imports, class instantiations) and constructs L2 (Architectural/Structural) and L3 (Implementation Detail) nodes. It connects these components via a local SQLite database to enable O(1) retrieval of isolated blast radii without depending on massive LLM context windows.

By default, the analyzer performs a standard structural extraction. This maps the call graph, class inheritance, and type exports but skips deeper semantic evaluations of logic blocks, maximizing speed and minimizing token usage during AST generation.

## INTERNAL BEHAVIOR

1. **File Discovery**: The analyzer reads the `.gitignore` file to exclude un-tracked files and `node_modules/`, retrieving only source files supported by the active language grammars.
2. **AST Parsing**: Passes chunks of files to a `worker_threads` pool. Native C++ Tree-sitter is utilized for high performance, gracefully falling back to WASM for unsupported environments.
3. **Graph Construction**: Extracts symbols and identifies relationships. Resolves cross-file imports and maps them into `node_links`.
4. **Database Upsert**: Batch-inserts the extracted nodes and edges into `.docuvia/local.db` within a single SQLite transaction to ensure ACID compliance.

## OPTIONS

`--deep`
: Instructs the analyzer to perform deep L3 semantic extraction. Beyond the structural call graph, this parses inner implementation details, comments, and specific domain logic to extract conceptual grounding.
: _Note: Deep extraction is significantly more CPU-intensive and time-consuming. It is recommended for initial baselining or when running within asynchronous metabolism queues rather than real-time pre-commit hooks._

## EXIT STATUS

**0**
Success. All targeted files were parsed and graph nodes successfully upserted into the local database.

**1**
Failure. Could not complete the analysis due to database locks, insufficient permissions, or critical parsing failures.

## EXAMPLES

Perform a standard structural analysis after initializing a project:

```bash
$ docuvia analyze
Project type: TypeScript (Node.js)
Suggested tags: backend, ast-parser, cli
✔ Processed 142 files.
✔ Upserted 3,420 nodes and 12,050 edges.
```

Perform a deep semantic extraction on a newly cloned repository:

```bash
$ docuvia analyze --deep
Project type: C/C++ (Firmware)
Suggested tags: bios, edk2, low-level
Parsing 512 files with semantic inspection...
✔ Processed 512 files.
✔ Upserted 14,000 nodes and 45,000 edges.
```

## SEE ALSO

- [docuvia-status(1)](status.md) - Verify the health and size of the extracted graph.
- [docuvia-detect-changes(1)](detect-changes.md) - Leverage the generated graph to compute blast radius.
