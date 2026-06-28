# Agentic RAG Competitor Analysis

## Current State
Docuvia utilizes a deep RAG auto-extraction pipeline that routes queries across Text, Graph, or Local Embeddings, persisting L1/L3 data effectively.

## Competitors
Copilot Workspace

## What Competitors Have That We Don't
- Seamless integration of issue trackers.
- Implicit contextual background extraction.
- Deep multi-file planning UI.

## What We Have That They Don't
- Structured L3 Decision Records anchored to commits, allowing deterministic retrieval of architectural intent.

## Fatal Flaws
- RAG retrieval often misses cross-module dependencies.
- Lack of robust intent routing temporal decay.

## Immediate Next Steps
- Implement robust hybrid search (vector + BM25).
- Implement intent routing temporal decay.
