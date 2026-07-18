# `doctor` — Execution Flow vs. Architecture Decisions

> Method: ADR context from `docs/gitbook/adr/**`; call sequence traced from
> `artifacts/cli/src/commands/doctor.ts` through `lib/ui-core/src/workflows/doctor/doctor-workflow.ts`.

`docuvia doctor` runs a set of independent diagnostics. It's the one command whose CLI layer does
real diagnostic work itself (the Claude/Cursor hooks check) rather than delegating everything to
`docuviaApi`.

> **Status update (Slice 5, §10c/§10d/§10e):** every new check this slice adds (the git
> post-commit-hook health check, the Tier B commit-cap backup, the Tier C LLM endpoint
> reachability probe, and the LSP binary presence check) goes through `DoctorWorkflow`, per
> decision 1b below — closing the asymmetry gap for the _new_ checks. The pre-existing
> Claude/Cursor hooks check in `doctor.ts` is left as-is (out of scope for this slice — see the
> Conflicts section below, still accurate for that one check). `doctor --fix` (T6) is also new: an
> opt-in, non-default flag that repairs the legacy-hook duplicate-block condition the git-hook
> check can detect but never silently repairs on its own.

## Sequence Diagram

```mermaid
sequenceDiagram
    actor User as User / AI Agent
    participant CLI as CLI (commands/doctor.ts)
    participant API as docuviaApi.doctor()
    participant WF as DoctorWorkflow
    participant DbRunner as DiagnosticRunnerDb
    participant GitRunner as DiagnosticRunnerGit
    participant FS as .docuvia/logs, hook files
    participant Git as IGitProvider
    participant KGit as IKnowledgeGitService
    participant Llm as ILlmClient
    participant Lsp as IEdgeResolutionProvider

    User->>CLI: docuvia doctor, skip flags, --fix
    CLI->>API: docuviaApi.doctor scopeId logger, skipDb, skipGit, skipLogs, fix, llmBaseUrl, llmApiKey

    API->>WF: new DoctorWorkflow execute
    opt not skipDb
        WF->>WF: check local.db exists
        alt db found
            WF->>DbRunner: checkHealth dbPath
        else db missing
            WF->>WF: diagnostics db_found FAIL
        end
    end
    opt not skipGit
        WF->>GitRunner: checkHealth workspaceRoot
        Note right of GitRunner: maps GIT_NETWORK_TIMEOUT and auth failures to actionable suggestions.
    end
    opt not skipLogs
        WF->>FS: read .docuvia/logs, scan JSONL for level 50 plus entries
    end
    opt not skipGit
        WF->>Git: readHookFile post-commit
        Note right of Git: absent/no-marker PASS; both markers FAIL duplicate; legacy-only FAIL; healthy-shaped -> resolvability probe (local node_modules/.bin, else npx --no-install docuvia).
        opt fix and duplicate detected
            WF->>KGit: repairDuplicatePostCommitHook workspaceRoot
            Note right of KGit: marker-bounded extraction, under the knowledge-branch lock -- never runs unless --fix was passed.
        end
    end
    opt not skipDb and not skipGit
        WF->>WF: open local.db readonly, isTierBCommitCapExceeded
        Note right of WF: always PASS (decision 1d) -- a normal, expected state either way.
    end
    opt llmBaseUrl supplied
        WF->>Llm: initialize baseUrl apiKey, checkAvailability
        Note right of Llm: not configured is PASS; configured-but-unreachable is the one real FAIL this check reports.
    end
    WF->>Lsp: checkAvailability workspaceRoot
    Note right of Lsp: same token/method analyze --escalate-to-lsp's own gate uses -- always PASS, reason surfaced as the message.
    WF-->>API: allPassed, diagnostics map

    API-->>CLI: result
    CLI->>CLI: print PASS or FAIL per diagnostic, with suggestion if any

    opt not skipHooks
        CLI->>FS: fs.stat claude hook file, cursor hook file directly
        Note right of FS: doctor.ts, not the orchestration layer, does this check itself.
        FS-->>CLI: found or not found per platform
    end
    CLI-->>User: overall PASS or FAIL, exit 1 if any FAIL
```

## Step → ADR Mapping

| Step                                                                                                                    | Governing ADR(s)                                                                  | Verdict                                             |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------- |
| DB / git / logs diagnostics via `docuviaApi.doctor()`                                                                   | `architecture/virtual-contracts-architecture.md` (Orchestration Layer)            | ✅ Match                                            |
| Git diagnostics map specific error codes to actionable suggestions                                                      | `architecture/error-handling-architecture.md`                                     | ✅ Match                                            |
| Git-hook health / commit-cap / LLM reachability / LSP binary checks all go through `DoctorWorkflow`, resolving by token | `phase1-decision-integration.md` §10 (decision 1b)                                | ✅ Match                                            |
| `doctor --fix`'s repair is opt-in only, never runs without the flag                                                     | `phase1-decision-integration.md` §10d                                             | ✅ Match                                            |
| Claude/Cursor hooks check runs directly in `doctor.ts` via `fs.stat`, not through `docuviaApi`                          | `architecture/virtual-contracts-architecture.md` (Presentation Layer constraints) | ⚠️ **Asymmetric, not a hard violation** — see below |

## Conflicts Found

None rising to a hard ADR violation.

### Observation: the Claude/Cursor hooks check is the one diagnostic the Presentation layer still runs itself

`virtual-contracts-architecture.md` scopes the Presentation layer's job as "parses user input, calls
`docuviaApi`, and formats the output," and its only explicit constraint is being "strictly forbidden
from accessing `lib/core`, `lib/schema`, or any underlying implementations directly." `doctor.ts`'s
Claude/Cursor hooks check (`fs.stat` on the Claude/Cursor hook file paths) doesn't reach into
`lib/core`/`lib/schema`, so it doesn't break that specific rule — but it does mean `doctor` still has
two different shapes for what should be the same kind of check: seven diagnostics (`db_found`/
`db_runner`, `git_reachability`/`git_runner`, `logs`, `tier_b_commit_cap`, `git_hook`,
`llm_reachability`, `lsp_binary`) go through `DoctorWorkflow`/`docuviaApi.doctor()` in the
Orchestration layer, while the Claude/Cursor hooks presence check is plain filesystem logic living
directly in the CLI command. `DoctorOptions` is even duplicated as two separate interfaces
(`doctor-workflow.ts` and `doctor.ts`) with `skipHooks` only on the CLI-side one. Slice 5
(phase1-decision-integration.md §10, decision 1b) deliberately closed this asymmetry for every _new_
check it added, but left the pre-existing Claude/Cursor hooks check untouched — folding it in is a
separate, independent cleanup not gated on this slice. Not a conflict against any stated rule, but
an asymmetry still worth resolving for that one remaining check.
