# `docuvia query`

The `query` command searches the local SQLite knowledge graph for specific nodes, concepts, or symbols. 

> **Note on Docuvia2:** Local Vector Search has been officially deprecated. The `query` command uses strict Heuristic Keyword Querying (FTS5 + BM25 matching) and 1-hop SQL joins. It does NOT invoke an LLM for agentic 4-way routing.

## Usage

```bash
docuvia query <search_query>
```

### Arguments

- `<search_query>`: The keyword or concept to search for. If omitted, the wizard will prompt you.

## Under the Hood

When you run `docuvia query`:

1. **FTS5 Search**: The query layer hits the SQLite FTS5 virtual tables to find matching L2 (Implementation) or L3 (Domain Concept) nodes.
2. **Context Block Assembly**: Instead of dumping raw JSON, the results are formatted into a strict `<docuvia_context>` XML block. This is designed for safe prompt injection, preventing context bloat.
3. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/query.log`.

## Examples

Find context regarding authentication:
```bash
docuvia query "authentication middleware"
```

Interactive mode:
```bash
docuvia query
```
