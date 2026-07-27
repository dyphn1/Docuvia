# `docuvia query`

The `query` command searches the local SQLite knowledge graph for specific nodes, concepts, or symbols.

> **Note on Docuvia2:** Local Vector Search has been officially deprecated. The `query` command uses strict Heuristic Keyword Querying (FTS5 + BM25 matching) and 1-hop SQL joins. It does NOT invoke an LLM for agentic 4-way routing.

## Usage

```bash
docuvia query [search_query] [flags]
```

## Options

### Arguments

- `[search_query]`: The keyword or concept to search for. If omitted, the command will fail-fast unless `--interactive` is specified to trigger a prompt.

### Flags

- `--format=<human|prompt>`: Specify the output format. `human` formats the output into a terminal-friendly list, while `prompt` packages the results into a strict `<docuvia_context>` XML block optimized for safe prompt injection.
- `--limit=<number>`: Limit the number of search results returned.
- `--interactive`, `-i`: Opt-in to interactive prompts (e.g. to prompt for the missing `<search_query>`).

## Under the Hood

When you run `docuvia query`:

1. **FTS5 Search**: The query layer hits the SQLite FTS5 virtual tables to find matching L2 (Implementation) or L3 (Domain Concept) nodes.
2. **Context Block Assembly**: Instead of dumping raw JSON, the results can be formatted into a strict `<docuvia_context>` XML block when `--format=prompt` is used. This is designed for safe prompt injection, preventing context bloat.
3. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/query.log`.

## Examples

Find context regarding authentication (human readable):

```bash
docuvia query "authentication middleware" --format=human
```

Find context packaged for prompt injection:

```bash
docuvia query "verifyToken" --format=prompt
```

Interactive mode:

```bash
docuvia query --interactive
```
