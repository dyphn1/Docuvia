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

We will adopt the **Thin Transport / Fat Orchestrator** paradigm (inspired by Hermes Agent) to decouple data transformation from execution I/O:

1. **Thin `ProviderTransport` Interface**: Transports are pure, stateless mappers. They contain NO HTTP clients, NO SDKs, and NO retry logic.
   - `convert_messages()`, `convert_tools()`: Maps internal models to provider-specific payloads.
   - `build_http_request()`: Generates the exact URL, Headers, and JSON body required.
   - `normalize_response()`, `normalize_stream_chunk()`: Maps provider-specific responses/chunks back to a unified `NormalizedResponse`.
   - `extract_cache_stats()`, `map_finish_reason()`: Unifies telemetry and stopping conditions.
2. **Fat `LlmOrchestrator`**: A single, central engine handles all actual I/O.
   - Executes raw HTTP requests (fetch) and handles Server-Sent Events (SSE) natively, completely bypassing bulky vendor SDKs.
   - Manages connection timeouts, `AbortController`, Rate Limiting, and Exponential Backoff centrally.
   - Executes the unified Tool-Calling loop and persists token telemetry via Drizzle ORM.
3. **Centralized Library (`@workspace/llm-orchestrator`)**: To prevent LLM execution logic, HTTP fetching, and token tracking from scattering across the codebase (e.g., in `api-server`, `cli`, or `kg-engine`), we will replace `integrations-openai-ai-server` with a strictly bounded, single-purpose library package.
   - This library acts as the sole gatekeeper for all AI interactions, encapsulating both the `LlmOrchestrator` and all concrete `ProviderTransport` classes (`OpenAiTransport`, `AnthropicTransport`, `GeminiTransport`).
   - Consuming applications simply import this library and call `Orchestrator.execute()`. They will have zero knowledge of HTTP headers, SSE, or vendor specifics.

## Consequences

- **Positive**: High Testability. Transports are pure functions. We can unit test OpenRouter, Anthropic, or Gemini payload generation perfectly without mocking HTTP or needing API keys.
- **Positive**: Zero SDK Bloat. By handling raw HTTP and SSE parsing centrally, we avoid downloading massive vendor SDKs, minimizing bundle size and cold-start latency.
- **Positive**: Unified Telemetry & Retries. The central orchestrator ensures that prompt caching metrics, tool-call tracking, and exponential backoff behave identically across all providers.
- **Negative**: The orchestrator must handle low-level SSE stream parsing and HTTP fetch intricacies, increasing the complexity of the core execution loop.
