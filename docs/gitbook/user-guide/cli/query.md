# docuvia-query(1)

## NAME

docuvia-query - Query the knowledge graph for nodes, relationships, and context

## SYNOPSIS

`docuvia query <target> [--local] [--format=human|prompt]`

## DESCRIPTION

The `docuvia query` command enables manual or programmatic interrogation of the knowledge graph. It searches for specific concepts, functions, classes, or architectural L2 nodes.

Because Docuvia is optimized to act as the Cognitive Baseline for AI Agents, this command exposes raw retrieval pathways to output highly dense, token-optimized context blocks. An AI agent (or a human developer) can pipe the output of this command directly into their prompt to provide exact topological context without polluting the context window with full-file reads.

## INTERNAL BEHAVIOR

The query engine operates across multiple tiers:

1. **Direct Match**: Looks for exact symbol matches in the L3 node index.
2. **Semantic Match**: If configured, performs an embedding-based search for architectural concepts.
3. **Graph Traversal**: Retrieves `CALLS`, `IMPORTS`, and `IMPLEMENTS` edges connected to the found node.

## OPTIONS

`<target>`
: The target to search for. Can be a symbol name (e.g., `intent-router`), an architectural concept, or a file path.

`--local`
: Forces the query to resolve entirely against the local `.docuvia/local.db` instance. If omitted, it may attempt to query the configured remote API server if available.

`--format=<human|prompt>`
: Controls the output structure.
: _ `human` (default): Prints formatted, colorized text designed for visual reading in a terminal.
: _ `prompt`: Returns a markdown-structured, compact context block optimized specifically for ingestion by LLMs.

## EXIT STATUS

**0**
Success. Target found and context returned.

**1**
Failure. Target could not be found, or the database is uninitialized.

## EXAMPLES

Query the local graph for a specific utility function:

```bash
$ docuvia query "formatDate" --local --format=human
Found L3 Node: formatDate
File: src/utils/time.ts
Callers:
  - src/components/DatePicker.tsx (12 calls)
  - src/services/reporting.ts (2 calls)
```

Extract token-optimized context and feed it directly to an AI CLI tool:

```bash
$ docuvia query "auth flow" --format=prompt > auth_context.md
$ my-ai-cli "Refactor the password reset logic using the context inside auth_context.md"
```

## SEE ALSO

- [docuvia-analyze(1)](analyze.md) - Ensure the target data exists in the local database.
- [docuvia-extract(1)](extract.md) - Extract decisions strictly bound to a single file.
