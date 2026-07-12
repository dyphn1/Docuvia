---
id: PLAT-002
title: Local-First Architecture & Graceful Degradation
status: accepted
date: 2026-07-02
domains: [platform]
supersedes: [legacy/ADR-002]
superseded_by: []
---

# Local-First Architecture & Graceful Degradation

## Context
Codebases contain highly sensitive IP. SaaS-first tools face immense friction during enterprise adoption due to data exfiltration concerns. Additionally, developers frequently work offline or in secure environments where relying on a cloud server for core functionality (like AST parsing or structural navigation) is a non-starter.

## Decision
We adopt a strict "Local-First" architecture. The Docuvia VS Code Extension must be able to function as a standalone, offline application.

1. **Local State Ownership**: All source code, AST processing, and the primary Knowledge Graph (`local.db`) reside on the user's machine.
2. **Opt-In Sync**: Connection to the Docuvia API Server is purely optional (used for Team Sync and advanced Agentic Cloud RAG).
3. **Graceful Degradation**: If the API server is unreachable, or if local LLM inference is unavailable, the extension must gracefully degrade to deterministic AST heuristics rather than crashing.

## Consequences
- Requires porting heavy analysis logic to run efficiently within the VS Code Extension Host (via WASM/Web Workers).
- Complex synchronization logic required to merge local graphs with the cloud server (Eventual Consistency).
