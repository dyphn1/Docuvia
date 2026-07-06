# docuvia-status(1)

## NAME

docuvia-status - Verify the health and statistics of the local index database

## SYNOPSIS

`docuvia status`

## DESCRIPTION

The `docuvia status` command performs a diagnostic check on the local SQLite knowledge graph (`.docuvia/local.db`). It verifies schema integrity, database accessibility, and compiles a statistical summary of the currently extracted knowledge layers.

This command is non-destructive and acts purely as a read-only observability tool. It is often the first step in troubleshooting when AI agents report missing context or when AST synchronization appears delayed.

## INTERNAL BEHAVIOR

Upon execution, the command runs several lightweight `SELECT COUNT(*)` queries against the primary Drizzle schemas:

- **L1 Tags**: High-level domains and repository taxonomies.
- **L2 Nodes**: Architectural building blocks, clusters, and modules.
- **L3 Nodes**: Implementation details, functions, classes, and variables.
- **Edges**: Directed relationships (e.g., `CALLS`, `IMPORTS`, `EXTENDS`) connecting the nodes.

It also validates the presence and schema version of `.docuvia/local.db`.

## OPTIONS

This command currently takes no explicit options from the command line.

## EXIT STATUS

**0**
Success. Database is healthy, schema versions match, and the file is accessible.

**1**
Failure. Database is corrupted, locked, or missing entirely. This exit code usually indicates that `docuvia init` or `docuvia analyze` needs to be run.

## EXAMPLES

Check the status of a fully parsed repository:

```bash
$ docuvia status
Database: .docuvia/local.db
Status: Healthy

Total Nodes: 450
L1 Tags: 5
L2 Architecture Nodes: 23
L3 Implementation Nodes: 422
Total Edges: 890
```

## SEE ALSO

- [docuvia-init(1)](init.md) - Initialize the database if missing.
- [docuvia-analyze(1)](analyze.md) - Re-populate the database if counts are 0.
