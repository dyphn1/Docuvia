# Docuvia — System Roadmap (Local-First Paradigm)

> **Single Source of Truth (SSOT) for Project Phases & Architecture**
> This document defines what features belong to which phase. For implementation status, refer strictly to `roadmap-checklist.md`.
> **Core Principle:** Docuvia is an Agentic OS. Local-First architecture and Git-Isomorphic synchronicity are paramount.

## Phase 1: API Server & Foundation (The Metabolism Engine)
- Core Database schemas & ORM setup (`projects`, `commits`, `nodes`).
- Document Ingestion (PDF, Word, PPTX, Build Logs).
- Agentic RAG Orchestrator (Intent Router with 4-way routing).
- Asynchronous Server-side Metabolism (DLQ, background syncing).

## Phase 2: Local-First VS Code Client
- Standalone Engine (Graceful Degradation for offline).
- Zero-to-One Workspace Onboarding (`/init`).
- Multi-root Workspace Support.
- Local Token Management & Chunking Configs.

## Phase 3: Swarm Intelligence & Git-Isomorphic Sync
- Background Distillation Job (Compressing `correction_examples`).
- Temporal Decay Scoring (`lastVerifiedAt`).
- O(1) Fast-Path Filters (`#attach` tags).
- Orphan Branch Read/Write Protocol (The Git-Isomorphic Graph).

## Phase 4: Human-in-the-Loop & Operations (Server-Side Extensions)
- **Review Queue:** Review Task generation, Resolution Workflow, and Feedback Loop.
- **Integrations:** GitHub PR Webhooks, Slack/Teams Bot Notifications.
- **Export & Portability:** Markdown/JSON Offline Export capabilities.
- **Prompt Engineering:** Project-level LLM Prompt Template Management.

## Phase 5: The AST Microkernel (Deep Local Analysis)
- AST Microkernel & Plugin Ecosystem (`@workspace/plugin-ast-typescript`, see ADR-024).
- Zero-Server Deep Traversal & Pure Local SQLite Cache (see ADR-024).
- Local Context Compression & Proxy Layer (Token reduction pipeline).
- Sub-second Incremental Watch & Local Git Hooks (see ADR-024).
- Jupyter & Multi-Modal Engineering Parsers.

## Phase 6: Architecture Hardening & Stabilization (The Tech Debt Phase)
- **Data Layer:** `pgvector` migration (replacing in-memory cosine similarity).
- **Concurrency:** True Distributed Locks (`FOR UPDATE SKIP LOCKED`) replacing fake in-memory Mutex.
- **Security:** Strict Auth middleware preventing IDOR across all export/query endpoints.
- **Client Synchronization:** `docuvia sync` CLI bidirectional state merging.
- **Ingestion:** SVN architecture drift correction and Multi-part artifact upload fixes.
- **Pipeline Filters:** Re-enable commit score noise filtering.
