# `docuvia status`

Show local knowledge graph database row counts and high-level statistics of the local SQLite index.

## Usage

```bash
docuvia status
```

## Options

_(This command does not accept any options, arguments, or flags.)_

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
