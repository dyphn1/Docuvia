# AST & Semantic Graph Competitor Analysis

## Current State
Docuvia currently relies on a local-first SQLite schema tailored for multi-tier L1/L2/L3 abstraction tracking rather than just raw code symbols. It utilizes multi-language Web-tree-sitter worker pools.

## Competitors
GitNexus, Sourcegraph (Cody / sg)

## What Competitors Have That We Don't
- Real-time incremental tree-sitter updates without full rebuilds.
- Deep cross-language call graph resolution.
- Enterprise-scale indexing capabilities.

## What We Have That They Don't
- **Isomorphic Engine**: By strictly adhering to `web-tree-sitter`, Docuvia's AST engine can run in the Node.js CLI *and* inside the VS Code Web Extension (browser). GitNexus completely fails in a pure browser/Web IDE environment because it relies on C++ binaries.
- **Intent Binding (L2/L3)**: We don't just extract structural syntax. Our graph schema is purpose-built to attach Human/AI Architectural Intent (`l3_nodes`) directly to the AST nodes, creating an Agentic RAG graph.

## Fatal Flaws
- Incomplete multi-language support.
- Poor incremental parsing performance.

## Immediate Next Steps
- Adopt incremental AST diffing.
- Finalize TypeScript symbol resolution.
