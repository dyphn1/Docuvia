---
id: GRPH-003
title: Unified Isomorphic AST Microkernel
status: accepted
date: 2026-07-04
domains: [graph]
supersedes: [legacy/ADR-020]
superseded_by: []
---

# Unified Isomorphic AST Microkernel

## Context

AST parsing is required both locally within the VS Code Extension (for real-time anchoring and editor feedback) and on the backend server (for batch processing and graph synchronization). Utilizing different parsers (e.g., `ts-morph` on the server and `typescript` API in the client) creates semantic drift and logic duplication.

## Decision

We utilize a Unified Isomorphic AST Microkernel built around WASM-compiled parsers (e.g., `tree-sitter` WASM bindings or a lightweight equivalent like `@babel/parser` if strictly TS/JS) that can execute identically in Node.js, Web Workers (VS Code Extension host), and the browser.

_(In Docuvia2, this is successfully implemented within `lib/ast-core` and `lib/plugins-ast`, acting as the shared backbone for code analysis)._

## Consequences

- Guarantees 100% semantic parity between client and server parsing.
- Imposes constraints: the chosen parser must compile to WASM and perform acceptably without native bindings.
