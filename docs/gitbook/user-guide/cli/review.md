# docuvia-review(1)

## NAME

docuvia-review - Compute structural blast radius and risk scores against a base branch

## SYNOPSIS

`docuvia review [--baseRef=<branch_or_commit>]`

## DESCRIPTION

The `docuvia review` command leverages the local knowledge graph to calculate the exact blast radius of current modifications. Rather than relying on simple text diffs (which lack semantic understanding), it queries the SQLite graph to trace upstream and downstream dependencies affected by changed AST nodes.

This command performs a Breadth-First Search (BFS) against the `node_links` schema, traversing caller/callee paths, implementations, and exports. It outputs a risk score (**LOW**, **MEDIUM**, **HIGH**, **CRITICAL**) indicating the likelihood of introducing a regression based on the density of affected dependents and execution flows.

This is exceptionally valuable as a pre-commit check or CI gate, warning developers (and AI agents) when modifying a "God object" or deeply shared utility.

## OPTIONS

`--baseRef=<branch_or_commit>`
: Defines the comparative baseline. Docuvia compares the current working tree against this reference. If omitted, the command attempts to automatically resolve the repository's default integration branch (e.g., `main`, `master`, or `develop`).

## EXIT STATUS

**0**
Success. Risk score computed. A successful exit does not mean the risk is low, only that the calculation succeeded.

**1**
Failure. Could not resolve the base branch, or the local knowledge graph (`.docuvia/local.db`) does not exist or is corrupted.

## EXAMPLES

Check the blast radius of uncommitted changes against the main branch:

```bash
$ docuvia review --baseRef=main
Analyzing structural changes against main...

Risk Score: HIGH
Affected Flows:
- User Authentication Flow (via auth.middleware.ts)
- Data Export Pipeline (via export-service.ts)

Warning: 15 downstream dependents detected.
Review the dependents list before proceeding.
```

## SEE ALSO

- [docuvia-query(1)](query.md) - Manually query specific paths or nodes affected by the change.
- [docuvia-analyze(1)](analyze.md) - Ensure your local graph is up to date before detecting changes.
