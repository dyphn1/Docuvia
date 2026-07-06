# Phase 2: AST Microkernel & Semantic Diffing

## 🎯 Objective

Deliver zero-LLM-cost structural code analysis and smart blast radius detection via local WASM AST extraction.

## 🛠️ Implementation Method

- **Smart Blast Radius (WASM):** Implement web-tree-sitter to parse Git diff line ranges. Compare old/new ASTs for smart pruning.
- **Progressive Enrichment (LSP Dual Engine):** Dynamically boot an LSP to supplement WASM AST analysis for unsaved editor buffers.
- **Local Context Compression:** Compress token footprint before sending AST contexts to LLMs.

### ⚠️ Precautions

- **Avoid OOM:** Ensure AST extraction doesn't crash on huge monorepos.

## 📋 Feature Tracking

This phase tracks the following specific features. Click on any feature to view its real implementation details, tests, and up-to-date status.

| Feature                                  | Status  | Link                                                              |
| :--------------------------------------- | :------ | :---------------------------------------------------------------- |
| AST Microkernel Architecture             | ✅ Done | [View Details](features/ast-microkernel-architecture.md)          |
| AST Plugin Architecture                  | ✅ Done | [View Details](features/ast-plugin-architecture.md)               |
| TypeScript `implements`/`extends` Parser | 🔲 TODO | [View Details](features/typescript-implements-extends-parser.md)  |
| Smart Blast Radius (WASM Semantic Diff)  | ✅ Done | [View Details](features/smart-blast-radius-wasm-semantic-diff.md) |
| Zero-Server Deep Traversal               | ✅ Done | [View Details](features/zero-server-deep-traversal.md)            |
| Local Context Compression                | ✅ Done | [View Details](features/local-context-compression.md)             |
| Sub-second Incremental Watch             | ✅ Done | [View Details](features/sub-second-incremental-watch.md)          |
