# docuvia-snapshot(1)

## NAME

docuvia-snapshot - Pack the local knowledge graph directly into a git orphan branch

## SYNOPSIS

`docuvia snapshot`

## DESCRIPTION

The `docuvia snapshot` command re-scans the workspace from scratch and packs the resulting knowledge graph directly into the `docuvia-knowledge` git orphan branch — no central server required. This is Docuvia's server-less, git-native distribution model: the graph travels with the repository itself, retrievable by anyone who clones it, without depending on `.docuvia/local.db` (a local SQLite cache) being present or in sync.

Because it produces a complete, self-contained snapshot every run, `snapshot` always re-parses every discovered file — it does not reuse `docuvia init`'s SQLite hash cache to skip unchanged files, even if `init` was just run against the same tree. This is intentional: there is currently no mechanism to merge previously-known graph nodes for skipped files into a new snapshot, so skipping would silently produce an incomplete graph.

## OPTIONS

This command currently takes no explicit options from the command line.

## EXIT STATUS

**0**
Success. The knowledge graph was packed and committed to the `docuvia-knowledge` branch.

**1**
Failure. AST parsing failed unrecoverably, or the git orphan-branch pack step failed.

## EXAMPLES

Pack the current knowledge graph into the orphan branch, no server needed:

```bash
$ docuvia snapshot
✔ Successfully packed local knowledge to branch. Nodes: 84386, call/import sites: 442630
```

Note: the `call/import sites` count is the number of raw, unresolved import/call statements encountered during this pass — a different, larger metric than `docuvia export --topology`'s resolved graph-edge count. The two are not directly comparable; see [`docs/analysis/docuvia-cli-vs-gitnexus-2026-07-10.md`](../../../analysis/docuvia-cli-vs-gitnexus-2026-07-10.md) for why.

## SEE ALSO

- [docuvia-init(1)](init.md) - Builds the queryable local SQLite cache; `snapshot` is independent of it but commonly run alongside it.
- [docuvia-sync(1)](sync.md) - Pushes knowledge to a central _server_ instead of a local git branch.
