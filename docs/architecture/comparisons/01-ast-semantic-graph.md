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
- Local-first SQLite schema tailored specifically for multi-tier L1/L2/L3 abstraction tracking, tying architectural intent directly to AST nodes.

## Fatal Flaws
- Incomplete multi-language support.
- Poor incremental parsing performance.

## Immediate Next Steps
- Adopt incremental AST diffing.
- Finalize TypeScript symbol resolution.
