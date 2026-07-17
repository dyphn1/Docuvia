---
id: LLM-002
title: Bridge to CLIProxyAPI for Multi-Provider LLM Access
status: accepted (Fully Verified - 2026-07-17)
date: 2026-07-14
domains: [llm]
supersedes: [llm/LLM-001]
superseded_by: []
---

# Bridge to CLIProxyAPI for Multi-Provider LLM Access

> **Implementation status**: Accepted / Fully Verified (已完全實現與驗證 - 2026-07-17)。
> 於 2026-07-16 (Slice 1 - Wire 2) 的實作中，`AnalyzeWorkflow.executeDecisionExtraction` 已完全實作了
> L3 的持久化與 Upsert 去重（Content-Hash 碰撞去重 + 增加 occurrence_count，保存完整 provenance
> 例如 extraction_model 與 source_files）。此前規畫中，其 LLM/decision-extraction 部分原為 print-only，
> 現已完全落實本地持久化，超前原有 ADR 所描述之狀態。

## Context

[LLM-001](LLM-001-multi-provider-abstraction.md) (carrying forward legacy `ADR-026`) proposed that Docuvia2 build its own multi-provider LLM engine in-house: a `ProviderTransport` per vendor (OpenAI/Anthropic/Gemini), a central `LlmOrchestrator` handling raw HTTP + SSE parsing, retries, and rate limiting, plus a `@workspace/llm-orchestrator` package to host it all. None of this was ever implemented — it remains Task #7, fully deferred, with zero LLM invocation paths anywhere in Docuvia2 today.

Building and maintaining that engine ourselves means owning OAuth login flows per vendor, per-vendor SSE/streaming quirks, multi-account/key rotation, and staying current as each provider's API evolves — all before a single feature can use an LLM. [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) is a self-hosted, open-source Go proxy that already solves this: it performs OAuth login against Claude Code, Codex, Gemini, and Grok subscriptions, manages multi-account pooling/load balancing, and re-exposes the result behind OpenAI/Anthropic/Gemini/Codex-compatible HTTP endpoints (streaming, tool calls, multimodal input included).

## Decision

We supersede LLM-001's in-house transport layer. Docuvia2 will **not** build `ProviderTransport`/`LlmOrchestrator`/per-vendor SDKs. Instead:

1. **Treat CLIProxyAPI as an external Technology Provider**, in the same category [PLAT-003](../platform/PLAT-003-remote-sync-technology-provider.md) established for `RemoteSyncClient`: a self-hosted service Docuvia2 calls over HTTP, not a library it embeds.
2. **One thin client, one surface.** Docuvia2 ships a single `ILlmClient` speaking CLIProxyAPI's OpenAI-compatible `/v1/chat/completions` endpoint (streaming + tool calls) — the most standard and complete of the surfaces CLIProxyAPI exposes. No per-vendor transports, no SSE parsing per vendor, no vendor SDKs bundled.
3. **Deployment/auth ownership stays with the user.** The user installs, configures, and runs CLIProxyAPI themselves (its own OAuth logins, account pools, and provider routing happen entirely on that side, out of process). Docuvia2 never performs OAuth and never holds a provider's native API key.
4. **Configuration injection follows the PLAT-003 pattern**: the client is constructed with a `baseUrl` (the user's CLIProxyAPI instance) and an optional `apiKey` (CLIProxyAPI's own gate, if the user enabled one), both sourced via `docuviaMemory` at the call site — never read from `process.env` directly inside the client itself. The (future) Presentation-layer consumer reads these from `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` / `AI_DOCUVIA_INTEGRATIONS_OPENAI_API_KEY` — naming carried forward from old Docuvia's `AI_INTEGRATIONS_OPENAI_BASE_URL`/`_API_KEY`, mirroring how `sync` reads `DOCUVIA_API_URL`/`MCP_PAT`. `apiKey` is CLIProxyAPI's own gate key, never the underlying provider's native API key.
5. **Model selection is a pass-through string.** Which underlying vendor/model (Claude, GPT, Gemini, Grok) serves a request is expressed as the `model` field in the chat-completions body and resolved by CLIProxyAPI; Docuvia2 does not implement provider-routing logic of its own.

## Consequences

- **Positive**: Task #7 shrinks from "build a multi-provider LLM engine" to "write one HTTP client for one compatible endpoint" — nearly all the scope in legacy ADR-026 (N transports, per-vendor SSE, OAuth flows, multi-account balancing) is eliminated, not deferred.
- **Positive**: Zero vendor SDKs bundled, inheriting ADR-026's "Zero SDK Bloat" goal for free, without building the orchestrator that goal was originally attached to.
- **Positive**: Reuses the already-established `RemoteSyncClient`/PLAT-003 shape (timeout enforcement, `DocuviaError` wrapping, `docuviaMemory` config injection) — no new architectural pattern needed.
- **Negative**: Introduces a hard runtime dependency on an external, user-managed process. If CLIProxyAPI isn't running, isn't configured, or its upstream OAuth session has expired, every LLM-backed feature must degrade gracefully rather than fail unhandled.
- **Negative**: CLIProxyAPI is a third-party OSS project outside Docuvia2's control — its own auth model, endpoint shape, or supported providers can change upstream and are a supply-chain risk to monitor.
- **Deferred to implementation**: which command becomes the first consumer of `TOKENS.LlmClient` (planned: `docuvia analyze`'s LLM/decision-extraction half), the model-name/alias convention forwarded to CLIProxyAPI, and any user-facing configuration/setup UX for pointing Docuvia2 at a running CLIProxyAPI instance.
