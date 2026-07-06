# docuvia-clean(1)

## NAME

docuvia-clean - Wipe the local knowledge graph database

## SYNOPSIS

`docuvia clean`

## DESCRIPTION

The `docuvia clean` command destructively removes the local SQLite index database (`.docuvia/local.db`).

This command is safe to use in the context of the wider ecosystem because the local database acts exclusively as an ephemeral cache and query engine. It does **not** delete any pushed knowledge residing on the remote server, nor does it delete the Git orphan `docuvia-knowledge` branch.

Use this command when AST parser logic has drastically changed (e.g., an upgrade to Docuvia core), when you encounter corrupted graph states, or when you want to force a completely fresh `analyze` pass from scratch without residual node thrashing.

## OPTIONS

This command currently takes no options.

## EXIT STATUS

**0**
Success. The local database was successfully removed from the filesystem.

**1**
Failure. The file could not be deleted, potentially due to file locking by an active MCP server process, lack of permissions, or unexpected OS-level locks.

## EXAMPLES

Reset the local graph state and perform a clean analysis:

```bash
$ docuvia clean
✔ Successfully removed .docuvia/local.db
$ docuvia analyze
...
```

## SEE ALSO

- [docuvia-analyze(1)](analyze.md) - Re-populate the database after cleaning.
