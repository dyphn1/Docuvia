# `doctor` — Execution Flow vs. Architecture Decisions

> Method: ADR context from `docs/gitbook/adr/**`; call sequence traced from
> `artifacts/cli/src/commands/doctor.ts` through `lib/ui-core/src/workflows/doctor/doctor-workflow.ts`.

`docuvia doctor` runs a set of independent diagnostics, every one of them through `DoctorWorkflow`
in the Orchestration layer — the CLI layer only parses flags, calls `docuviaApi.doctor()`, and
prints the result.

> **Status update (Slice 5, §10c/§10d/§10e):** every new check this slice adds (the git
> post-commit-hook health check, the Tier B commit-cap backup, the Tier C LLM endpoint
> reachability probe, and the LSP binary presence check) goes through `DoctorWorkflow`, per
> decision 1b below — closing the asymmetry gap for the _new_ checks. The pre-existing
> Claude/Cursor hooks check in `doctor.ts` was left as-is at the time (out of scope for that
> slice). `doctor --fix` (T6) is also new: an opt-in, non-default flag that repairs the
> legacy-hook duplicate-block condition the git-hook check can detect but never silently repairs
> on its own.
>
> **Status update (2026-07-19):** the Claude/Cursor hooks check has now been folded into
> `DoctorWorkflow` too (`runAgentHooksDiagnostic`, keys `agent_hooks_claude`/`agent_hooks_cursor`),
> closing the one remaining asymmetry. It reuses `CLAUDE_HOOKS_DIR`/`CURSOR_HOOKS_DIR`/
> `DOCUVIA_HOOK_JS_FILENAME`/`DOCUVIA_HOOK_CJS_FILENAME`, moved from `artifacts/cli`'s
> `init-templates.ts` into `@workspace/core`'s `constants/paths.ts` so both the platform installers
> and `DoctorWorkflow` read the same path without a `lib/ui-core` -> `artifacts/cli` dependency.
> Always PASS regardless of presence/absence (owner-chosen, matching `LLM_NOT_CONFIGURED`'s "not
> configured is PASS" precedent) — a platform never selected at `init` is a legitimate state, not a
> defect; `DiagnosticStatus` has no severity between PASS and FAIL, so this never affects
> `allPassed`/exit code. `skipHooks` moved from a `doctor.ts`-only option onto `DoctorWorkflow`'s
> own `DoctorOptions`, closing the interface duplication this doc used to note.

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
    participant Lsp as IEdgeResolutionProvider (per registered language)

    User->>CLI: docuvia doctor, skip flags, --fix
    CLI->>API: docuviaApi.doctor scopeId logger, skipDb, skipGit, skipHooks, skipLogs, fix, llmBaseUrl, llmApiKey

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
    opt not skipDb
        WF->>WF: open local.db readonly, isTierBCommitCapExceeded
        Note right of WF: reads a store-persisted cumulative-changed-bytes counter (section 9m item 1) -- no IGitProvider call, gated by skipDb alone.
        Note right of WF: always PASS (decision 1d) -- a normal, expected state either way.
    end
    opt llmBaseUrl supplied
        WF->>Llm: initialize baseUrl apiKey, checkAvailability
        Note right of Llm: not configured is PASS; configured-but-unreachable is the one real FAIL this check reports.
    end
    WF->>Lsp: checkAvailability workspaceRoot, once per provider in the TOKENS.EdgeResolutionProviders registry
    Note right of Lsp: multi-language-lsp-support plan, Slice 0 -- iterates every registered language's provider (today just typescript), one diagnostic key per language (DOCTOR_DIAGNOSTIC_KEYS.LSP_BINARY(languageId)). Always PASS, reason surfaced as the message; same checkAvailability() method analyze --escalate-to-lsp's own gate uses.
    opt not skipHooks
        WF->>FS: fs.stat claude hook file, cursor hook file
        Note right of FS: folded into DoctorWorkflow -- closes the asymmetry this doc used to flag. Always PASS either way: not selecting a platform at init is a legitimate state, not a defect.
        FS-->>WF: found or not found per platform
    end
    WF-->>API: allPassed, diagnostics map

    API-->>CLI: result
    CLI->>CLI: print PASS or FAIL per diagnostic, with suggestion if any
    CLI-->>User: overall PASS or FAIL, exit 1 if any FAIL
```

## Step → ADR Mapping

| Step                                                                                                                    | Governing ADR(s)                                                                                         | Verdict                        |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ |
| DB / git / logs diagnostics via `docuviaApi.doctor()`                                                                   | `architecture/virtual-contracts-architecture.md` (Orchestration Layer)                                   | ✅ Match                       |
| Git diagnostics map specific error codes to actionable suggestions                                                      | `architecture/error-handling-architecture.md`                                                            | ✅ Match                       |
| Git-hook health / commit-cap / LLM reachability / LSP binary checks all go through `DoctorWorkflow`, resolving by token | [PLAT-007](../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md#reliability-slice-5-doctor) | ✅ Match                       |
| `doctor --fix`'s repair is opt-in only, never runs without the flag                                                     | [PLAT-007](../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md#reliability-slice-5-doctor) | ✅ Match                       |
| Claude/Cursor hooks check goes through `DoctorWorkflow`, same as every other diagnostic                                 | `architecture/virtual-contracts-architecture.md` (Orchestration Layer)                                   | ✅ Match (RESOLVED, see below) |

## Conflicts Found

None rising to a hard ADR violation.

### Observation: the Claude/Cursor hooks check is the one diagnostic the Presentation layer still runs itself (RESOLVED 2026-07-19)

`virtual-contracts-architecture.md` scopes the Presentation layer's job as "parses user input, calls
`docuviaApi`, and formats the output," and its only explicit constraint is being "strictly forbidden
from accessing `lib/core`, `lib/schema`, or any underlying implementations directly." `doctor.ts`'s
former Claude/Cursor hooks check (`fs.stat` on the Claude/Cursor hook file paths) never reached into
`lib/core`/`lib/schema`, so it never broke that specific rule — but it did mean `doctor` had two
different shapes for what should be the same kind of check: seven diagnostics (`db_found`/
`db_runner`, `git_reachability`/`git_runner`, `logs`, `tier_b_commit_cap`, `git_hook`,
`llm_reachability`, `lsp_binary`) went through `DoctorWorkflow`/`docuviaApi.doctor()` in the
Orchestration layer, while the Claude/Cursor hooks presence check was plain filesystem logic living
directly in the CLI command. `DoctorOptions` was even duplicated as two separate interfaces
(`doctor-workflow.ts` and `doctor.ts`) with `skipHooks` only on the CLI-side one. Slice 5
([PLAT-007's reliability section](../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md#reliability-slice-5-doctor))
deliberately closed this asymmetry for every _new_ check it added, but left the pre-existing
Claude/Cursor hooks check untouched at the time.

**Now resolved**: `runAgentHooksDiagnostic` in `doctor-workflow.ts` performs the same `fs.stat`
check, reporting `agent_hooks_claude`/`agent_hooks_cursor` through the uniform diagnostic shape.
`skipHooks` moved onto `DoctorWorkflow`'s own `DoctorOptions`, so the interface is no longer
duplicated; `doctor.ts` no longer imports `fs/promises` or the hook-path constants at all. The
constants themselves (`CLAUDE_HOOKS_DIR`, `CURSOR_HOOKS_DIR`, `DOCUVIA_HOOK_JS_FILENAME`,
`DOCUVIA_HOOK_CJS_FILENAME`) moved from `artifacts/cli`'s `init-templates.ts` into
`@workspace/core`'s `constants/paths.ts` (re-exported from `init-templates.ts` so every existing
platform-installer import path is unchanged) — the dependency direction otherwise would have been
backwards (`lib/ui-core` importing from `artifacts/cli`). Both PASS states are owner-chosen (not
auto-derived): absence is a legitimate "didn't select this platform at `init`" state, never a
defect, so this check can never FAIL and never affects `allPassed`/exit code.
