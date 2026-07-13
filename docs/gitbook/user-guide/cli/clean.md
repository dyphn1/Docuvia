# `docuvia clean`

The `clean` command wipes the local knowledge graph database (`local.db`) and resets the workspace state. It is useful for recovering from corrupted states, clearing the cache, or forcing a complete re-analysis of the codebase.

## Usage

```bash
docuvia clean
```

### Flags

- `--force`: Bypass confirmation and immediately wipe the database (useful in CI).
- `--logs`: Also delete the `.docuvia/logs/` directory containing all structured JSONL command history.
- `--interactive`: Launch the wizard to confirm deletion.

## Under the Hood

When you run `docuvia clean`:

1. **Strict Execution**: Deletes `local.db` immediately if confirmed or non-interactive.
2. **Wipe SQLite**: The `local.db` file in the `.docuvia/` directory is truncated/deleted. All AST nodes, cached Blob hashes, and relationship data are removed.
3. **Wipe Logs (Optional)**: If `--logs` is provided, the entire `.docuvia/logs/` directory is permanently deleted.
4. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/clean.log` (unless `--logs` was used, in which case the log directory is destroyed).

_(Note: `clean` does NOT delete the `docuvia-knowledge` git orphan branch)._

## Examples

Interactive clean:

```bash
docuvia clean
```

Force clean in a CI pipeline or headless script:

```bash
docuvia clean --force
```
