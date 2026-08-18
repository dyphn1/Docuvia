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

- `--format=<human|prompt|json>`: Specify the output format. `human` formats the output into a terminal-friendly list, `prompt` packages the results into a strict `<docuvia_context>` XML block optimized for safe prompt injection, and `json` emits the structured `LocalQueryResult` verbatim (pure JSON on stdout, no banner/spinner — for scripted/agent use). An unknown value fails fast with a list of the available formats.
- `--limit=<number>`: Limit the number of search results returned.
- `--interactive`, `-i`: Opt-in to interactive prompts (e.g. to prompt for the missing `<search_query>`).

## Under the Hood

When you run `docuvia query`:

1. **FTS5 Search**: The query layer hits the SQLite FTS5 virtual tables to find matching L2 (Implementation) or L3 (Domain Concept) nodes.
2. **Context Block Assembly**: Instead of dumping raw JSON, the results can be formatted into a strict `<docuvia_context>` XML block when `--format=prompt` is used. This is designed for safe prompt injection, preventing context bloat. `--format=json` skips the XML projection and serializes the underlying `LocalQueryResult` object (L2/L3/context, including `matchType` and any `tierBCoverage` hint) directly — the same shape the MCP query tool will return natively (roadmap items 29/31), so scripted consumers can rely on it.
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

Emit the structured result for a script/agent (no banner, no spinner — parseable stdout):

```bash
docuvia query "verifyToken" --format=json
```

Interactive mode:

```bash
docuvia query --interactive
```
