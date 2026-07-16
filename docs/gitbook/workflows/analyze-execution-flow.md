# `analyze` — Execution Flow vs. Architecture Decisions

> Method: ADR context from `docs/gitbook/adr/**`; call sequence traced from
> `artifacts/cli/src/commands/analyze.ts` through `lib/ui-core/src/workflows/analyze/analyze-workflow.ts`.
>
> **Updated for PLAT-007 Tier A** (see
> [phase1-decision-integration.md §6](../analysis/phase1-decision-integration.md#6-slice-2-tier-a--integration-level-design-decisions)):
> no-arg `analyze` is no longer a read-only config scan — it is now **auto mode**, dispatching to
> a sha fast-path no-op, full ingestion, or delta ingestion. The old config-scan-only diagram below
> is superseded by Mode A's new dispatch.

`docuvia analyze` is two genuinely different flows dispatched on one condition — whether
`targetPath` was given — so it gets two diagrams rather than one artificially merged one.

## Mode A — No `targetPath`: Auto Mode (Ingestion)

```mermaid
sequenceDiagram
    actor User as User / AI Agent / post-commit hook
    participant CLI as CLI (commands/analyze.ts)
    participant API as docuviaApi.analyze()
    participant WF as AnalyzeWorkflow.executeAutoMode
    participant Store as local.db (docuvia_meta)
    participant Full as runFullIngestion
    participant Delta as runDeltaIngestion
    participant Log as analyze.log (JSONL)

    User->>CLI: docuvia analyze, no path
    CLI->>API: docuviaApi.analyze scopeId logger
    API->>WF: new AnalyzeWorkflow execute
    WF->>Store: open local.db read-write
    WF->>Store: meta.get lastIngestedSourceSha
    alt HEAD equals lastIngestedSourceSha
        WF->>Log: analyze.delta.noop
        WF-->>API: kind autoDeltaNoop
    else graph has no project row or no L2 nodes
        WF->>Full: runFullIngestion
        Note right of Full: seedProjectRow -> runDiscoveryPipeline -> runParseAndPersist -> markSynced (init's own Phase 2-4 helpers, reused verbatim)
        Full->>Store: meta.set lastIngestedSourceSha = HEAD
        Full-->>WF: kind autoFullIngestion
        WF-->>API: result
    else non-empty graph, HEAD moved
        WF->>WF: resolve fromSha (meta key, else newest Docuvia-Source trailer, else fall through to full ingestion)
        WF->>Delta: runDeltaIngestion fromSha HEAD
        Note right of Delta: diff fromSha->HEAD, re-parse added/modified/renamed files, drop deleted files' L2 rows, classify modified files for the Tier B queue -- all under the knowledge-branch lock
        Delta->>Store: meta.set lastIngestedSourceSha = HEAD
        Delta-->>WF: kind autoDelta
        WF-->>API: result
    end
    API-->>CLI: result
    CLI-->>User: prints outcome-specific summary
```

## Mode B — `targetPath` given: Focused LLM Decision Extraction

```mermaid
sequenceDiagram
    actor User as User / AI Agent
    participant CLI as CLI (commands/analyze.ts)
    participant Env as process.env
    participant API as docuviaApi.analyze()
    participant WF as AnalyzeWorkflow
    participant Files as collectSourceFiles
    participant LLM as ILlmClient (CLIProxyAPI bridge)
    participant Log as analyze.log (JSONL)

    User->>CLI: docuvia analyze targetPath
    CLI->>Env: read AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL, AI_DOCUVIA_MODEL
    alt base url or model missing
        CLI-->>User: error, exit 1, hard failure not a silent skip
    end
    Note right of Env: Unlike sync.ts, missing LLM env is a hard failure here, by design.

    CLI->>API: docuviaApi.analyze scopeId logger, targetPath, llm config
    API->>WF: new AnalyzeWorkflow execute
    WF->>Log: analyze.focused.start

    alt target path does not exist
        WF-->>API: throw FS_READ_FAILED
    end

    WF->>Files: collectSourceFiles targetPath
    Files-->>WF: files, droppedFiles
    alt no files collected
        WF-->>API: decisions empty array
    end

    WF->>LLM: initialize baseUrl, apiKey
    WF->>LLM: chatCompletion system prompt plus file contents
    Note right of LLM: MATCH LLM-002 shape, one thin ILlmClient over CLIProxyAPI's OpenAI compatible endpoint.
    LLM-->>WF: raw content

    WF->>WF: strip markdown code fence, JSON.parse
    alt not valid JSON array
        WF-->>API: throw LLM_INVALID_RESPONSE
    else valid
        WF->>WF: map to ExtractedDecision records
        WF->>Log: analyze.focused.summary
        WF-->>API: kind decisionExtraction, decisions
    end
    API-->>CLI: result
    CLI-->>User: prints extracted decisions
```

## Step → ADR Mapping

| Step                                                                                            | Governing ADR(s)                                                                                                                                                                                                    | Verdict                                      |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Auto mode (fast-path / full ingestion / delta ingestion)                                        | [PLAT-007](../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md), [phase1-decision-integration.md §6](../analysis/phase1-decision-integration.md#6-slice-2-tier-a--integration-level-design-decisions) | ✅ Match                                     |
| Config scan (project type + tags) — now a step of full ingestion, not the whole command         | — (no dedicated ADR; feeds `init`'s discovery pipeline)                                                                                                                                                             | —                                            |
| `ILlmClient` over CLIProxyAPI's OpenAI-compatible endpoint, config injected via `docuviaMemory` | [LLM-002](../adr/llm/LLM-002-cliproxyapi-bridge.md)                                                                                                                                                                 | ⚠️ **ADR status note stale** — see below     |
| Missing LLM env vars → hard failure (exit 1), not silent skip                                   | code comment in `analyze.ts` contrasting itself with `sync.ts`'s missing-env behavior                                                                                                                               | ✅ Match (internally consistent, deliberate) |
| `analyze.start`/`analyze.focused.start`/`.summary` JSONL log                                    | [IFCE-003](../adr/interface/IFCE-003-persisted-structured-command-log.md)                                                                                                                                           | ✅ Match                                     |

## Conflicts Found

### LLM-002 says `analyze`'s LLM half has "no consumer yet"; it's fully implemented

[LLM-002](../adr/llm/LLM-002-cliproxyapi-bridge.md)'s implementation-status note (top of the file)
says:

> `ILlmClient`/`FetchLlmClient` (`lib/llm-api`) landed 2026-07-14 as a standalone Technology
> Provider — registered on `TOKENS.LlmClient`, **no consumer yet**. Planned first consumer:
> `docuvia analyze`'s LLM/decision-extraction half (**currently out of scope** per
> `analyze-workflow.ts`'s doc comment).

But `AnalyzeWorkflow.executeDecisionExtraction()` (`analyze-workflow.ts:100-212`) already resolves
`TOKENS.LlmClient`, calls `chatCompletion()` with a real system prompt and file contents, and parses
the response into `ExtractedDecision` records — this is a complete, working consumer, not a stub.
This lines up with the repo's own recent commit history (`feat(contracts,core,ui-core,cli):
implement analyze <targetPath> LLM decision extraction`), which post-dates LLM-002. The _shape_ of
the implementation matches LLM-002's decision exactly (one thin client, OpenAI-compatible endpoint,
config injected via `docuviaMemory`, env var names carried forward as prescribed) — only the ADR's
own "not yet implemented" status note is stale. **Recommendation**: update LLM-002's implementation-status
note now that analyze has a real consumer, so a future reader doesn't assume this integration is
still pending.
