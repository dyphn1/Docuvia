# `docuvia status`

The `status` command provides a health check and high-level statistics of the local SQLite knowledge graph.

## Usage

```bash
docuvia status
```

## Under the Hood

When you run `docuvia status`:

1. **Database Query**: It counts the number of L2 nodes (Implementation), L3 nodes (Domain Concepts), and Edges currently stored in `local.db`.
2. **UI Formatting**: The data is formatted into a clean CLI table using the interactive wizard shell.
3. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/status.log`.

## Examples

Check the current graph stats:
```bash
docuvia status
```
