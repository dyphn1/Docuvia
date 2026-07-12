# Retrieval (RETR) — Query, RAG Routing, Deduplication

⚠️ **Note: The "Review" in this domain is completely unrelated to the CLI `docuvia review` command.**

**Current Model**:
The `query` command currently **only implements FTS keyword search + 1-hop neighbors + heuristic extraction**. It completely lacks 4-way routing, temporal decay, and does not invoke an LLM. Local Vector Search has been officially deprecated.

## Decisions

| ID | Decision | Status | Notes |
|----|----------|--------|-------|
| [RETR-001](RETR-001-heuristic-keyword-query.md) | Heuristic Keyword Query Only | proposed | New: `query` bypasses LLMs |
| [RETR-002](RETR-002-context-block-for-prompt-injection.md) | Context Block for Prompt Injection | accepted | Carries forward legacy ADR-010 (Reduced scope) |
| [RETR-005](RETR-003-local-vector-search-deprecated.md) | Local Vector Search Deprecated | accepted | Carries forward legacy ADR-029 (Currently active) |
