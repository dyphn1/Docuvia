# docuvia-impact(1)

## NAME

docuvia-impact - Compute blast radius and risk level for a symbol

## SYNOPSIS

`docuvia impact <target> [--escalateToLsp]`

## DESCRIPTION

The `docuvia impact` command answers "what breaks if I change this?" for a single symbol, without requiring a git diff first. It performs a blast-radius lookup against the local knowledge graph — the same underlying logic used internally by `docuvia review` (per-changed-file) and by the `docuvia_impact` MCP tool exposed to AI coding assistants — and reports both the list of direct/indirect callers and a LOW/MEDIUM/HIGH/CRITICAL risk rating.

## INTERNAL BEHAVIOR

1. **Symbol Resolution**: Looks up `<target>` against the local `l2_nodes`/`l3_nodes` index.
2. **Blast Radius Traversal**: Walks incoming `node_links` edges to find every caller (direct and indirect).
3. **Risk Scoring**: Buckets the impacted-node count into LOW / MEDIUM (≥1) / HIGH (≥6) / CRITICAL (≥21) — the same thresholds `docuvia review` uses for its diff-driven risk score.

## OPTIONS

`<target>`
: The symbol, file, or module name to analyze. Same resolution rules as `docuvia query`.

`--escalateToLsp`
: Escalate to the TypeScript compiler (via the LSP enrichment layer) for precise reference resolution when the AST-only match is ambiguous or incomplete.

## EXIT STATUS

**0**
Success. Target found and blast radius reported (regardless of risk level).

**1**
Failure. Target could not be found, the local database is uninitialized, or no target was provided.

## EXAMPLES

Check the blast radius of a shared utility before refactoring it:

```bash
$ docuvia impact formatDate
Blast radius for formatDate:
  - DatePicker.tsx (function)
  - reporting.ts (function)
Risk level: MEDIUM
```

Escalate to the LSP for a more precise reference count:

```bash
$ docuvia impact formatDate --escalateToLsp
```

## SEE ALSO

- [docuvia-query(1)](query.md) - General-purpose symbol/file lookup.
- [docuvia-review(1)](review.md) - Same blast-radius logic, applied automatically to every file changed in a git diff.
