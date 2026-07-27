# `docuvia clean`

Wipe the local knowledge graph database (`local.db`) and reset the workspace state.

## Usage

```bash
docuvia clean [flags]
```

## Options

_(This command does not accept positional arguments.)_

### Flags

- `--interactive`, `-i`: Launch the wizard to confirm deletion before wiping. Without this flag, the database is wiped immediately.

## Under the Hood

When you run `docuvia clean`:

1. **Strict Execution**: Deletes `local.db` immediately if `--interactive` is not specified or if the prompt is confirmed.
2. **Wipe SQLite**: The `local.db` file in the `.docuvia/` directory is truncated/deleted. All AST nodes, cached Blob hashes, and relationship data are removed.
3. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/clean.log`.

_(Note: `clean` does NOT delete the `docuvia-knowledge` git orphan branch)._

## Examples

Interactive clean (requires confirmation):

```bash
docuvia clean --interactive
```

Force clean (non-interactive, deletes immediately):

```bash
docuvia clean
```

Force clean in a CI pipeline or headless script:

```bash
docuvia clean --force
```
