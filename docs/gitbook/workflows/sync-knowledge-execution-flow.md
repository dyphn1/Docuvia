# `sync-knowledge` — Execution Flow vs. Architecture Decisions

> Method: ADR context from `docs/gitbook/adr/**`; call sequence traced from
> `artifacts/cli/src/commands/sync-knowledge.ts` through
> `lib/ui-core/src/workflows/sync-knowledge/sync-knowledge-workflow.ts` and
> `lib/core/src/git/knowledge-git.service.ts`'s `reconcile()`.

`docuvia sync-knowledge` is the explicit, user-triggerable entry point for cross-clone
reconciliation of the `docuvia-knowledge` branch against `origin`. Purely a git operation — it never
opens `local.db`. Deliberately **not** auto-wired into the post-commit hook, since it's a network
call and firing it on every local commit would contradict the "zero-interruption" promise the hook
otherwise keeps.

## Sequence Diagram

```mermaid
sequenceDiagram
    actor User as User / AI Agent
    participant CLI as CLI (commands/sync-knowledge.ts)
    participant API as docuviaApi.syncKnowledge()
    participant WF as SyncKnowledgeWorkflow
    participant KG as KnowledgeGitService
    participant KLock as Knowledge Branch Lock
    participant Log as sync-knowledge.log (JSONL)

    User->>CLI: docuvia sync-knowledge
    CLI->>API: docuviaApi.syncKnowledge scopeId logger
    API->>WF: new SyncKnowledgeWorkflow execute
    WF->>Log: sync-knowledge.start

    WF->>KG: syncKnowledgeBranch workspaceRoot
    KG->>KLock: withKnowledgeBranchLock
    KLock->>KLock: getRemoteUrl
    alt no remote configured
        KLock-->>WF: status no-remote
    else remote configured
        KLock->>KLock: fetchRef origin, docuvia-knowledge
        alt fetch fails, offline
            KLock-->>WF: status no-remote, degrade gracefully
        else fetch ok
            KLock->>KLock: compare local vs remote tip sha
            alt remote sha missing
                KLock->>KLock: push local
            else local sha missing
                KLock->>KLock: fast forward local to remote
            else equal
                KLock-->>WF: status up-to-date
            else local is ancestor of remote
                KLock->>KLock: fast forward local
            else remote is ancestor of local
                KLock->>KLock: push local
            else true divergence
                KLock->>KLock: resolve winner by stamped source commit ancestry, else timestamp
                KLock->>KLock: create 2 parent merge commit, tree adoption
                KLock->>KLock: push merged result
            end
        end
    end

    WF->>Log: sync-knowledge.summary
    WF-->>API: status, branchTipSha
    API-->>CLI: result
    CLI-->>User: prints reconciliation status
```

## Step → ADR Mapping

| Step                                                                                        | Governing ADR(s)                                                                                              | Verdict                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Cross-clone reconciliation of the knowledge branch                                          | [STOR-001](../adr/storage/STOR-001-git-branch-source-of-truth.md) point 3                                     | ✅ Match                                                            |
| Divergence resolved by tree-adoption merge, winner picked by stamped source-commit ancestry | [STOR-001](../adr/storage/STOR-001-git-branch-source-of-truth.md) point 3, point 4 (`Docuvia-Source` trailer) | ✅ Match                                                            |
| Offline / no-remote degrades gracefully rather than failing                                 | `architecture/error-handling-architecture.md`                                                                 | ✅ Match                                                            |
| Not auto-wired into the post-commit hook                                                    | [PLAT-004](../adr/platform/PLAT-004-zero-interruption-invisible-indexing.md) ("zero-interruption")            | ✅ Match — deliberate, documented in the workflow's own doc comment |
| `sync-knowledge.start` / `.summary` JSONL log                                               | [IFCE-003](../adr/interface/IFCE-003-persisted-structured-command-log.md)                                     | ✅ Match                                                            |

## Conflicts Found

None found. This is the one command whose own doc comment pre-empts the most likely objection (“why
isn't this automatic like `snapshot`?”) with a direct architectural reason, and that reason lines up
exactly with PLAT-004's zero-interruption goal rather than contradicting it.
