# docuvia-extract(1)

## NAME

docuvia-extract - Extract decisions and semantic context from a specific file

## SYNOPSIS

`docuvia extract [path]`

## DESCRIPTION

The `docuvia extract` command isolates the ingestion pipeline to a specific scope. It executes AST parsing and L3 node extraction to derive semantic context and architectural decisions from your source code and documentation.

This command is designed for developers or AI agents who want to immediately verify what semantic context and architectural decisions Docuvia is deriving from a newly written or modified section of the repository. It serves as a rapid feedback loop for documentation validation, especially for checking if Architectural Decision Records (ADRs) are properly comprehended by the graph.

## OPTIONS

`[path]`
: (Optional) The absolute or relative path to the target you want to extract knowledge from.
: _ **File**: Extracts decisions specifically from the single provided file.
: _ **Directory**: Recursively scans and extracts decisions from all supported files within the given directory.
: \* **Omitted (None)**: Defaults to the entire repository (workspace root), recursively extracting decisions from all files in the project.

## EXIT STATUS

**0**
Success. File was successfully parsed and nodes extracted.

**1**
Failure. File does not exist, lacks read permissions, or uses an unsupported language grammar.

## EXAMPLES

Verify the extraction of a core routing service (single file):

```bash
$ docuvia extract src/core/intent-router.ts
Extracting knowledge from src/core/intent-router.ts...

Found L2 Node: Agentic RAG Router
Dependencies:
- intent-classifier
- vector-store
- local-db-connector
```

Extract decisions from an entire module (directory):

```bash
$ docuvia extract src/core/
Extracting knowledge from 12 files in src/core/...
```

Extract decisions for the entire repository (omitted path):

```bash
$ docuvia extract
Extracting knowledge from the entire repository...
```

## SEE ALSO

- [docuvia-analyze(1)](analyze.md) - Extract knowledge across the entire repository.
- [docuvia-query(1)](query.md) - Search for the nodes extracted by this command.
