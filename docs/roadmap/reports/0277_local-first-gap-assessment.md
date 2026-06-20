# Verification Report: Local-First ADR Gap Assessment

**Date:** 2026-06-20  
**Scope:** Compare the local-first architecture ADRs against the current implementation in `artifacts/vscode-client/` and `artifacts/api-server/`.

## Executive Summary

Docuvia is already genuinely usable in offline mode for the read path: the VS Code extension can initialize a workspace, load a knowledge graph from local `.docuvia/` files, fall back to the `docuvia-knowledge` orphan branch, and run local search / extraction without a configured server.

What is still missing is the full ADR-level local-first write loop:

- local SQLite write cache
- SyncOutbox queue
- `POST /sync/push` client wiring
- fetch / merge rehydration after sync
- pure local deep traversal and AST microkernel parity

In other words, the product has a strong local-first UX, but not the full local-first storage and synchronization model described in the ADRs.

## ADRs Reviewed

- [ADR-002 Local-First Architecture](../../design/adrs/ADR-002-local-first-architecture.md)
- [ADR-004 Git-Isomorphic Graph](../../design/adrs/ADR-004-git-isomorphic-graph.md)
- [ADR-001 VS Code Client Onboarding](../../design/adrs/ADR-001-vscode-client-onboarding.md)
- [ADR-008 Asynchronous Metabolism](../../design/adrs/ADR-008-asynchronous-metabolism.md)

## What Is Implemented Today

### 1. Read-path graceful degradation

`KnowledgeStore` already uses a three-tier fallback:

1. server snapshot when `server_url` is configured
2. local `.docuvia/` files
3. git fallback from `docuvia-knowledge`

Relevant code:

- [`KnowledgeStore.ts`](../../../artifacts/vscode-client/src/KnowledgeStore.ts#L142)
- [`KnowledgeStore.ts`](../../../artifacts/vscode-client/src/KnowledgeStore.ts#L153)
- [`KnowledgeStore.ts`](../../../artifacts/vscode-client/src/KnowledgeStore.ts#L190)

### 2. Offline user-facing features

These core features work without a server:

- TreeView rendering
- CodeLens rendering
- Hover previews
- local `/query`
- local `/extract`
- local `/init`

Relevant code:

- [`KnowledgeGraphTreeProvider.ts`](../../../artifacts/vscode-client/src/KnowledgeGraphTreeProvider.ts#L154)
- [`DocuviaCodeLensProvider.ts`](../../../artifacts/vscode-client/src/DocuviaCodeLensProvider.ts#L140)
- [`DocuviaHoverProvider.ts`](../../../artifacts/vscode-client/src/DocuviaHoverProvider.ts#L14)
- [`ChatParticipant.ts`](../../../artifacts/vscode-client/src/ChatParticipant.ts#L275)
- [`TaskRunner.ts`](../../../artifacts/vscode-client/src/TaskRunner.ts#L35)
- [`extension.ts`](../../../artifacts/vscode-client/src/extension.ts#L444)

### 3. Local onboarding guardrails

`/init` already checks for a clean working tree before creating the orphan branch and prompts for explicit consent.

Relevant code:

- [`extension.ts`](../../../artifacts/vscode-client/src/extension.ts#L481)
- [`extension.ts`](../../../artifacts/vscode-client/src/extension.ts#L559)

### 4. Server-side sync receiver exists

The server has a CQRS-style `/sync/push` route with advisory locking and orphan-branch writes.

Relevant code:

- [`sync.ts`](../../../artifacts/api-server/src/routes/sync.ts#L19)

## Main Gaps

### Gap 1: Offline writes are not backed by SQLite + outbox

ADR-002 describes a local SQLite write path with a `SyncOutbox`, but the current extension writes directly to `.docuvia/*.yaml` files. That is a simpler and useful local-first pattern, but it is not the same as the ADR’s CQRS/outbox design.

Impact:

- no durable event queue for offline edits
- no replayable sync log
- no local conflict staging model

### Gap 2: Client sync wiring does not match the server contract

The extension client still calls `POST /sync`, while the server exposes `POST /sync/push`. There is no end-to-end evidence that the sync path is connected to the current UI flow.

Relevant code:

- [`CentralServerClient.ts`](../../../artifacts/vscode-client/src/CentralServerClient.ts#L95)
- [`sync.ts`](../../../artifacts/api-server/src/routes/sync.ts#L19)

Impact:

- the designed sync loop is effectively split in two
- the correct server endpoint exists, but the client path appears stale

### Gap 3: Git-isomorphic delta projection is only partially realized

The repo has a working `git merge-base`-style fallback in design and reports, but the live extension still relies on file-based snapshot loading and broad reloads. The truly incremental ancestor-anchored graph projection remains a partial implementation rather than a full local-first baseline.

Relevant code and docs:

- [`ADR-004`](../../design/adrs/ADR-004-git-isomorphic-graph.md#L28)
- [`KnowledgeStore.ts`](../../../artifacts/vscode-client/src/KnowledgeStore.ts#L122)

### Gap 4: Milestone 4 local-first parity remains todo

The roadmap still marks the deeper local-first architecture as future work:

- AST microkernel
- pure local SQL / SQLite deep traversal
- local context compression
- sub-second incremental watch and Git hooks

Relevant roadmap entries:

- [`master-roadmap.md`](../master-roadmap.md#L53)

## Risk Assessment

### Low risk

- Current offline read-path usability is good.
- TreeView, Hover, and CodeLens have graceful degradation.
- `/init` is guarded against dirty working trees.

### Medium risk

- The write path is not architecturally aligned with the ADRs.
- Sync contract mismatch can cause future integration bugs.
- The codebase may accumulate divergence between the documented synchronization model and the shipped behavior.

### High risk

- If the team assumes the outbox flow already exists, subsequent features may build on a false premise.
- The roadmap may understate the amount of work remaining for true local-first parity.

## Recommendation

Treat the current state as:

> "Local-first UX is implemented; local-first storage/sync architecture is not yet complete."

The next concrete implementation step should be to choose one of these paths:

1. Implement the ADR-002 outbox model end-to-end, including SQLite cache, outbox queue, and `/sync/push` client wiring.
2. Simplify the ADRs to match the current shipping model, explicitly declaring YAML-on-filesystem as the supported local-first baseline.

Until that choice is made, the implementation should be described as partial local-first rather than fully completed local-first architecture.
