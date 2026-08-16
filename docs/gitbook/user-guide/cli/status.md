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

1. **Database Query**: It counts the number of L2 nodes (Implementation), L3 nodes (Domain Concepts), and Edges currently stored in `local.db`, plus the workspace-wide Tier B coverage (`processed / total` files).
2. **Tier C Queue (`tierCQueued`)**: The number of pending Tier C (LLM-inferred L3) candidates in `tierCQueue` — surfaced so a permanently-empty queue (the "Tier C never backfills" symptom, issue #58) is visible rather than silent. Candidates are enqueued by delta ingestion and drained at `analyze --escalate-to-lsp` (pre-push), so a non-zero count is expected between commits; a queue that never grows while commits happen suggests the post-commit hook's backgrounded ingestion isn't firing (see `docuvia doctor`'s `post_commit_ingestion` check).
3. **UI Formatting**: The data is formatted into a clean CLI table using the interactive wizard shell.
4. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/status.log`.

## Examples

Check the current graph stats:

```bash
docuvia status
```
