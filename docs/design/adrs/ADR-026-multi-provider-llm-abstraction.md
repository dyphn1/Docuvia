---
Date: 2026-07-03
Status: Proposed
Supersedes: ADR-004 (Partial)
---

# ADR-026: Multi-Provider LLM Abstraction Layer

## Context

Currently, our LLM integration (per ADR-004) is strictly hardcoded to the OpenAI SDK. While this simplified the initial bootstrapping of Docuvia, it limits our flexibility. Our consolidated status report flagged this as a known architectural trade-off.
To support enterprise users and reduce vendor lock-in, Docuvia must support multiple providers (OpenAI, Anthropic, Gemini) seamlessly. However, different providers have different SDK interfaces, particularly concerning how they handle system prompts, error responses (e.g., rate limits), and Server-Sent Events (SSE) for streaming.

## Decision (Proposed)

We will introduce a **Multi-Provider LLM Abstraction Layer** using the Adapter pattern:

1. **Unified Interface (`ILlmProvider`)**: All internal services (Intent Router, Metabolism Worker) will code against a standard interface that dictates methods like `generateCompletion`, `generateStream`, and `generateEmbedding`.
2. **Unified Data Transfer Objects (DTOs)**: We will define standard `LlmMessage`, `LlmCompletionOptions`, and `LlmStreamChunk` objects to shield our business logic from provider-specific payload structures.
3. **Error Mapping & Differentiated Retries**: Each provider adapter will catch its SDK-specific exceptions and map them to unified errors (e.g., `LlmRateLimitError`). A generic retry wrapper will handle exponential backoff based on these unified error types.
4. **Package Refactoring**: The existing `integrations-openai-ai-server` will be generalized into a `@workspace/ai-providers` package containing concrete adapters (`OpenAiAdapter`, `AnthropicAdapter`, `GeminiAdapter`).

## Consequences

- **Positive**: Complete vendor independence. Users can plug in Anthropic or Gemini without altering Docuvia's core routing or generation logic.
- **Positive**: Reliable retry handling. Differentiated error mapping prevents infinite retry loops on non-transient errors (like authentication failures).
- **Negative**: Increased maintenance burden to keep multiple SDK adapters up to date with upstream changes.
