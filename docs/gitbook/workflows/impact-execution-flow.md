# `impact` — Execution Flow vs. Architecture Decisions

> Method: ADR context from `docs/gitbook/adr/**`; call sequence traced from
> `artifacts/cli/src/commands/impact.ts` through `lib/ui-core/src/workflows/impact/impact-workflow.ts`.

`docuvia impact` is a 1-hop blast-radius lookup by target name (exact match, then `LIKE`). It
shares the automatic staleness-check hydration guard with `query`, `status`, and `review`.

## Sequence Diagram

```mermaid
sequenceDiagram
    actor User as User / AI Agent
    participant CLI as CLI (commands/impact.ts)
    participant API as docuviaApi.impact()
    participant WF as ImpactWorkflow
    participant Hydr as ensureHydrated guard
    participant Store as GraphStore (local.db, readonly)
    participant Svc as ImpactService
    participant Log as impact.log (JSONL)

    User->>CLI: docuvia impact target, escalateToLsp flag
    alt target missing
        CLI-->>User: error, exit 1
    end

    CLI->>API: docuviaApi.impact scopeId logger, target, escalateToLsp
    API->>WF: new ImpactWorkflow execute
    opt escalateToLsp passed
        WF->>WF: log warn, escalate to lsp not implemented
    end
    WF->>Log: impact.start

    WF->>Hydr: ensureHydrated workspaceRoot logger
    Note right of Hydr: MATCH STOR-002 staleness check, shared with query, status, review.

    WF->>Store: openStore readonly
    alt db still not found
        WF-->>API: throw DB_OPEN_FAILED, run docuvia init
    end

    WF->>Svc: getBlastRadius store, target
    Note right of Svc: MATCH IMPT-001 single hop SQL join, exact then LIKE match.
    alt target not found
        WF->>Log: impact.summary found false
        WF-->>API: null
    else found
        Svc-->>WF: blastRadius entries
        WF->>Svc: computeRiskLevel blastRadius.length
        WF->>Log: impact.summary found true
        WF-->>API: blastRadius, riskLevel
    end
    API-->>CLI: result
    CLI-->>User: prints blast radius and risk level
```

## Step → ADR Mapping

| Step                                                                       | Governing ADR(s)                                                          | Verdict                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| Staleness-check auto-hydrate before read                                   | [STOR-002](../adr/storage/STOR-002-sqlite-ephemeral-query-engine.md)      | ✅ Match                            |
| 1-hop SQL JOIN blast radius (exact-then-LIKE) as the fast heuristic filter | [IMPT-001](../adr/impact/IMPT-001-sql-single-hop-blast-radius.md)         | ✅ Match                            |
| `escalateToLsp` accepted as a flag                                         | [IMPT-003](../adr/impact/IMPT-002-lsp-for-absolute-quality.md)            | ⚠️ **Documented no-op** — see below |
| `impact.start` / `impact.summary` JSONL log                                | [IFCE-003](../adr/interface/IFCE-003-persisted-structured-command-log.md) | ✅ Match                            |

## Conflicts Found

### `escalateToLsp` is accepted but does nothing — a known, self-documented gap against IMPT-003

[IMPT-003](../adr/impact/IMPT-002-lsp-for-absolute-quality.md) mandates the LSP-escalation layer as
the actual quality guarantee, explicitly calling the SQL single-hop pass (IMPT-001) an
insufficient "first pass" filter that must not be trusted for automated refactoring decisions.
`ImpactWorkflow`'s own doc comment (`impact-workflow.ts:19`) is upfront about the gap: _"`escalateToLsp`
is accepted but treated as a documented no-op, matching old Docuvia — reserved for a future
TypeScript-compiler-backed precise-reference pass."_ This isn't a silent conflict — the code
self-discloses it — but it means `impact`'s blast radius is, today, always the IMPT-001 heuristic
layer only, never the IMPT-003 LSP-verified layer the ADR treats as mandatory for trustworthy
results. Flagged here because it's the same underlying gap [review](review-execution-flow.md) has,
just already acknowledged in a code comment rather than silent.
