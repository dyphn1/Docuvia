# `docuvia snapshot`

The `snapshot` command is responsible for persisting the state of the local SQLite knowledge graph to the git repository for versioning and distribution.

## Usage

```bash
docuvia snapshot
```

## Under the Hood

When you run `docuvia snapshot`:

1. **Serialization**: The current state of `local.db` is read and serialized into `JSONL` (JSON Lines) and granular Markdown files.
2. **Wholesale Export**: Utilizing `libgit2` bindings, the system streams the files to the `docuvia-knowledge` orphan git branch.
3. **Continuous Merge Strategy**: Unlike a destructive wipe, the branch utilizes a `merge` strategy, continuously stacking updates. If merge conflicts arise (e.g., from team members pushing concurrent knowledge updates), it automatically resolves them favoring the latest state.
4. **Commit Reverse Lookup**: The first 7 characters of your source code's commit hash are appended to the knowledge branch's commit message. This allows near-instant reverse lookup of architectural impact using `git log --grep="<7-char-hash>"`.
5. **Command Logging**: A structured JSONL log is written to `.docuvia/logs/snapshot.log`.

*(Note: This command is automatically triggered by the `post-commit` hook installed via `docuvia init`).*

## Examples

Manually force a snapshot export:
```bash
docuvia snapshot
```
