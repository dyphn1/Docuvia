# ADR 032: Parallel Swarm Review and Background Agentic RAG

## Status

Accepted

## Context

Currently, Docuvia processes AI requests sequentially. This limits our ability to perform deep, multi-faceted analyses within a reasonable timeframe. Our roadmap includes advanced capabilities outlined in `parallel-swarm-review-concepts.md` and `background-agentic-rag.md`, inspired by the GitNexus PR Swarm Review.

To fully realize these capabilities, we need to transition from a sequential processing model to an architecture that supports dispatching multiple specialized AI subagents (e.g., Security Reviewer, Architecture Critic, Database Expert) in parallel. Furthermore, these specialized agents cannot rely on a single, static context. Each agent must be able to independently traverse the codebase and query the knowledge graph—performing "Background Agentic RAG"—to gather domain-specific insights without blocking the execution of other agents.

However, firing multiple concurrent agents to query a single local SQLite DB or Vector Index will inevitably cause `SQLITE_BUSY` (database is locked) and quickly exhaust the LLM provider rate limits. We must define explicit architectural constraints to prevent these crashes before implementing the multi-threading dispatcher.

## Decision

We will implement an asynchronous parallel dispatch and aggregation engine within Docuvia, governed by strict concurrency and rate-limiting constraints.

1. **Database Concurrency (SQLite WAL)**: SQLite must be configured in `WAL` (Write-Ahead Logging) mode to allow concurrent readers.
2. **Read/Write Lock Queue & Task Dispatcher**: Because SQLite WAL is insufficient for concurrent writes or complex FTS/Vector queries under load, we will introduce a mandatory `Read/Write Lock Queue` and a `Task Dispatcher`. The dispatcher will be bounded by a strict concurrency limit (e.g., max 3 active parallel agents) mapped to the user's local hardware capabilities to prevent CPU starvation and database deadlocks.
3. **LLM Rate Limit Handling**: LLM provider rate limits will be managed using token buckets and exponential backoff. Non-critical swarm agents will fall back to local models (e.g., via Ollama) when the primary provider's rate limits are nearing exhaustion.
4. **Parallel Dispatch**: The master orchestrator will break down complex requests and dispatch them concurrently to multiple specialized subagents, mediated by the dispatcher queue.
5. **Background Agentic RAG**: Each subagent will operate in its own asynchronous execution context with independent access to the RAG pipeline via the read/write queue.
6. **Aggregation/Synthesis Phase**: Once all parallel subagents complete their analysis, a primary orchestrator will synthesize the independent reports, resolve contradictions, and compile a final output.

## Consequences

- **Positive:** Drastically reduced latency for comprehensive code reviews and complex multi-step reasoning tasks.
- **Positive:** Higher quality, specialized feedback due to domain-specific agent personas and targeted RAG contexts.
- **Positive:** System stability is guaranteed under load via explicit queues and hardware-mapped concurrency limits.
- **Negative:** Increased architectural complexity regarding state management, lock queuing, exponential backoff, and timeout resolution for parallel tasks.
