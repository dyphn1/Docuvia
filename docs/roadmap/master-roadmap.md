# Docuvia — System Development & Verification Roadmap

> **Single Source of Truth (SSOT) for Project Progress**
> This document tracks the implementation status of features. It DOES NOT explain architectural decisions. 
> For the "Why" and "How", follow the `[Design Spec]` anchor links to the respective `docs/design/*.md` files.
> Last Updated: 2026-06-06

## Milestone 1: Knowledge Graph Foundation & API Server

| Task | Status | Design Spec Anchor | Verification / Evidence |
| :--- | :---: | :--- | :--- |
| **1.1 Core Database & ORM Setup** | ✅ Done | `N/A (Legacy)` | `lib/db/src/schema/` |
| **1.2 Multi-Format Ingestion (Git, PDF, Build logs)** | ✅ Done | `N/A (Legacy)` | `api-server/src/lib/document-parser.ts` |
| **1.3 RAG Orchestrator (Intent Router)** | ✅ Done | `[agentic-rag-routing.md](../design/agentic-rag-routing.md)` | `api-server/src/lib/intent-router.ts` |
| **1.4 Server-Side Metabolism & Mutex** | ✅ Done | `[asynchronous-metabolism.md](../design/asynchronous-metabolism.md)` | `api-server/src/routes/metabolism.ts` |

---

## Milestone 2: VS Code Client (Local-First Architecture)

| Task | Status | Design Spec Anchor | Verification / Evidence |
| :--- | :---: | :--- | :--- |
| **2.1 Standalone Engine (Graceful Degradation)** | ✅ Done | `[local-first-architecture.md](../design/local-first-architecture.md)` | `CentralServerClient.ts` Fallback Logic |
| **2.2 Zero-to-One Onboarding (`@docuvia /init`)** | ⚠️ WIP | `[vscode-client-onboarding.md](../design/vscode-client-onboarding.md)` | Needs parsing of `package.json` ecosystem markers. |
| **2.3 Multi-root Workspace Support** | ✅ Done | `[local-first-architecture.md](../design/local-first-architecture.md)` | `TaskRunner.ts` dynamic root scoping |
| **2.4 Virtual Nodes (Unassigned Group) UI** | ✅ Done | `[knowledge-abstraction-strategy.md](../design/knowledge-abstraction-strategy.md)`| `KnowledgeGraphTreeProvider.ts` |
| **2.5 Token Limits & Chunking Configs** | ✅ Done | `[token_management.md](../ai_plans/token_management.md)` | Enforce `maxFileSizeKBWarning` in `extension.ts` |

---

## Milestone 3: Swarm Intelligence & Git-Isomorphic Sync

| Task | Status | Design Spec Anchor | Verification / Evidence |
| :--- | :---: | :--- | :--- |
| **3.1 Background Distillation Job** | ✅ Done | `[self-evolution-architecture.md](../design/self-evolution-architecture.md)`| `correction_examplesTable` summary logic |
| **3.2 Temporal Decay Scoring** | ✅ Done | `[agentic-rag-routing.md](../design/agentic-rag-routing.md)` | `lastVerifiedAt` math in `intent-router.ts` |
| **3.3 O(1) Fast-Path Filters (`#attach`)** | ✅ Done | `[agentic-rag-routing.md](../design/agentic-rag-routing.md)` | Regex pre-filters skipping LLM latency |
| **3.4 Orphan Branch Read/Write Protocol** | ❌ Todo | `[server-side-zero-to-one.md](../design/server-side-zero-to-one.md)` | `orphan-branch-writer.ts` bidirectional sync with Client |
| **3.5 Diff Projection & Ancestor Anchoring** | ❌ Todo | `[git-isomorphic-graph.md](../design/git-isomorphic-graph.md)` | `git merge-base` lookup for un-indexed commits |

---

## E2E Testcase Coverage

| Test Suite Target | Status | Coverage Target | Evidence / Script |
| :--- | :---: | :---: | :--- |
| Unit: RAG Math (Decay & Cosine) | ✅ Pass | 80% | `vitest` in `api-server/test/unit` |
| Integration: DB Transactions | ✅ Pass | 100% | `withRollback()` factories |
| E2E: VS Code Extension Onboarding | ❌ Todo | N/A | Needs Playwright spec for `/init` command |
