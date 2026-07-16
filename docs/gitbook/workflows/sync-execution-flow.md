# `sync` — Execution Flow vs. Architecture Decisions

> Method: ADR context from `docs/gitbook/adr/**`; call sequence traced from
> `artifacts/cli/src/commands/sync.ts` through `lib/ui-core/src/workflows/sync/sync-workflow.ts`
> and `lib/remote-api/src/fetch-remote-sync-client.ts`.

`docuvia sync` pushes locally-generated L3 decisions for a set of changed files to the remote
Docuvia backend. It's split into two panels: resolving inputs at the CLI boundary, then the
transactional push itself.

## Phase 0 — Resolve Project ID, Env & Changed-File Set

```mermaid
sequenceDiagram
    actor User as User / AI Agent
    participant CLI as CLI (commands/sync.ts)
    participant Wizard as Wizard UI
    participant Env as process.env

    User->>CLI: docuvia sync, project id, commit sha
    alt project id missing and stdin is a TTY
        CLI->>Wizard: askInput for project id
    else project id missing, non TTY
        CLI->>CLI: error and exit 1
    end

    CLI->>Env: read DOCUVIA_API_URL and MCP_PAT
    alt either env var missing
        CLI-->>User: warn and skip sync, exit 0
    end
    Note right of Env: MATCH PLAT-003, presentation layer reads env, not the provider itself.

    opt commit sha not passed and stdin is not a TTY
        CLI->>CLI: read commit sha from stdin
    end
```

## Phase 1 — Changed Files, Store Lookup & Locked Push

```mermaid
sequenceDiagram
    participant CLI as CLI (commands/sync.ts)
    participant API as docuviaApi.sync()
    participant WF as SyncWorkflow
    participant Git as GitProvider
    participant Store as GraphStore (local.db, readonly)
    participant Remote as FetchRemoteSyncClient
    participant Lock as sync-state.json Lock
    participant Log as sync.log (JSONL)

    CLI->>API: docuviaApi.sync scopeId logger
    API->>WF: new SyncWorkflow execute, projectId, commitSha
    WF->>Log: sync.start

    alt commit sha given
        WF->>Git: getFilesChangedByCommit
    else no commit sha
        WF->>Git: listModifiedFiles plus listUntrackedFiles
    end

    alt no changed files
        WF-->>API: synced 0, nothing to sync
    end

    WF->>Store: openStore readonly
    WF->>Remote: initialize apiUrl and pat
    WF->>Remote: fetchRemoteL2Nodes projectId
    Note right of Remote: MATCH PLAT-003, 30s AbortSignal timeout on every remote call.
    WF->>Store: findNodesForChangedFiles

    WF->>Lock: withSyncStateLock
    Lock->>Lock: load sync-state.json
    Lock->>Lock: diff against synced content hashes, build CREATE_L3 events
    alt no new events
        Lock-->>WF: synced 0, skipped count
    else new events exist
        Lock->>Remote: pushSyncEvents projectId events
        Lock->>Lock: save updated sync-state.json
        Lock-->>WF: synced count, skipped count
    end

    WF->>Log: sync.summary
    WF-->>API: result
    API-->>CLI: result
```

## Step → ADR Mapping

| Step                                                                                     | Governing ADR(s)                                                                                          | Verdict                                                                                                           |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Remote client: 30s timeout, wrapped errors, config via `docuviaMemory` not `process.env` | [PLAT-003](../adr/platform/PLAT-003-remote-sync-technology-provider.md)                                   | ✅ Match — timeout verified at `lib/remote-api/src/fetch-remote-sync-client.ts:11` (`REQUEST_TIMEOUT_MS = 30000`) |
| CLI (presentation layer) reads `DOCUVIA_API_URL`/`MCP_PAT` from `process.env`            | `architecture/application-lifecycle-and-state.md` ("only the Presentation layer may touch `process.env`") | ✅ Match                                                                                                          |
| Content-hash dedup against `sync-state.json` under a lock                                | — (no dedicated ADR; local implementation detail)                                                         | —                                                                                                                 |
| `sync.start` / `sync.summary` JSONL log                                                  | [IFCE-003](../adr/interface/IFCE-003-persisted-structured-command-log.md)                                 | ✅ Match                                                                                                          |

## Conflicts Found

None found. `sync` is the one command that talks to an external service, and it matches PLAT-003's
template exactly, including the specific 30-second timeout value the ADR prescribes.
