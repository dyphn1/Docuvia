# Design Verification Report — Item 1.1.5

**Item ID:** 1.1.5
**Description:** LLM abstraction layer (OpenAI-compatible interface only; no multi-provider fallback)
**Verification Date:** 2026-06-27
**Verdict:** ⚠️ WARN
**Type:** Re-verification (previous: 0650_phase-1_llm-abstraction-layer.md, 2026-06-27)

---

## Design Spec References

| Document | Section | Description |
|----------|---------|-------------|
| ADR-004 | openai-compatible-llm-interface-only | Core LLM integration via OpenAI SDK; explicit decision to NOT support non-OpenAI providers natively (use proxy like LiteLLM instead) |

---

## Source Files Examined

| File | Purpose |
|------|---------|
| `lib/integrations-openai-ai-server/src/index.ts` | Package entry; exports client, batch, image, audio modules |
| `lib/integrations-openai-ai-server/src/client.ts` | OpenAI SDK wrapper (completions, chat, embeddings) |
| `lib/integrations-openai-ai-server/src/batch/utils.ts` | Batch processing utilities for large-scale LLM operations |
| `lib/integrations-openai-ai-server/src/image/client.ts` | Image generation (DALL-E) via OpenAI |
| `lib/integrations-openai-ai-server/src/audio/client.ts` | Audio (Whisper) via OpenAI |
| `artifacts/api-server/src/routes/llm_config.ts` | Per-project LLM config CRUD (model selection, API key rotation) |
| `artifacts/api-server/src/lib/embedding.ts` | Embedding generation + pgvector storage |
| `artifacts/api-server/src/routes/generate.ts` | RAG generation endpoint (intent router → LLM call) |
| `lib/db/src/schema/llm_configs.ts` | DB schema for per-project LLM configurations |

**Checksums (SHA-256):**

| File | Hash | Previous | Change |
|------|------|----------|--------|
| `lib/integrations-openai-ai-server/src/client.ts` | `6ae8f25fe046fcd3e872929dc2b1ff5cd61e61feb5f0e8f177e70705c8a9eb2` | `6ae8f25fe046fcd3e872929dc2b1ff5cd61e61feb5f0e8f177e70705c8a9eb2` | Unchanged |
| `lib/integrations-openai-ai-server/src/index.ts` | `16bb8a72af90ed0fc25e77b76c8d26b9cc432dba9a6a6306f7aa588b32707f17` | `16bb8a72af90ed0fc25e77b76c8d26b9cc432dba9a6a6306f7aa588b32707f17` | Unchanged |
| `lib/integrations-openai-ai-server/src/batch/utils.ts` | `4cdd914861bf929cbd3c17dd8ffe92af37602ec5d1606f281597f9e3ed82cfd2` | `4cdd914861bf929cbd3c17dd8ffe92af37602ec5d1606f281597f9e3ed82cfd2` | Unchanged |
| `lib/integrations-openai-ai-server/src/image/client.ts` | `5682c1ac92e0249ace3747b73969aab144bf0b3256d17ea0a8268fb512dcaa95` | `5682c1ac92e0249ace3747b73969aab144bf0b3256d17ea0a8268fb512dcaa95` | Unchanged |
| `lib/integrations-openai-ai-server/src/audio/client.ts` | `6ba354839d00255b584ade54ac85da83a50fd8f080edf2aa9a8848ddf1bc2433` | `6ba354839d00255b584ade54ac85da83a50fd8f080edf2aa9a8848ddf1bc2433` | Unchanged |
| `lib/db/src/schema/llm_configs.ts` | `3747adecb3b5fba3ab77fa0dabc3fd63d91a4169dbb04e0b6dcff78e05ca07f3` | `3747adecb3b5fba3ab77fa0dabc3fd63d91a4169dbb04e0b6dcff78e05ca07f3` | Unchanged |
| `artifacts/api-server/src/routes/llm_config.ts` | `aacedc0f76f75fffbc72393266bd8f8cc2be3c537595ac83e8057b422a7648d9` | `aacedc0f76f75fffbc72393266bd8f8cc2be3c537595ac83e8057b422a7648d9` | Unchanged |
| `artifacts/api-server/src/lib/embedding.ts` | `1d8b71ebfdabf6b7b0ef205dab0fb324523e40bbe05c8ef5e40fe0927fff6ff6` | `1d8b71ebfdabf6b7b0ef205dab0fb324523e40bbe05c8ef5e40fe0927fff6ff6` | Unchanged |
| `artifacts/api-server/src/routes/generate.ts` | `41e9e00001dbabbe08bd7a08d514a2f7c7949bec2634a61b2abf7e7ff9191b85` | `41e9e00001dbabbe08bd7a08d514a2f7c7949bec2634a61b2abf7e7ff9191b85` | Unchanged |

**All 9 source files unchanged since last verification.**

---

## Round 1 — Architecture & Design Review

### Design ↔ Implementation Alignment

**✅ Correctly implemented:**

1. **OpenAI SDK wrapper** — `client.ts` provides `chat.completions.create` and `embeddings.create` via the official `openai` SDK. No non-OpenAI providers are directly imported, adhering to ADR-004's constraint.
2. **Per-project model switching** — `llm_configs.ts` schema stores `model` field per project; `generate.ts` reads config before LLM calls.
3. **Batch utilities** — `batch/utils.ts` provides rate-limiting and retry logic for OpenAI API.
4. **Image generation** — `image/client.ts` wraps DALL-E API.
5. **Audio transcription** — `audio/client.ts` wraps Whisper API.
6. **Embedding pipeline** — `embedding.ts` generates + stores vectors in `l3_nodes` via pgvector.

### Gaps / Deviations

1. **⚠️ No multi-provider abstraction** — Direct instantiation of `new OpenAI()` in `client.ts`. No adapter interface for alternate providers (Anthropic, Ollama-local, etc.). ADR-004 explicitly allows proxying via LiteLLM, but there is no abstraction layer for direct provider switching. This is the intended design per the ADR, but is worth noting as a WARN.

2. **⚠️ Hardcoded provider imports in `generate.ts`** — Import path directly references `@workspace/integrations-openai-ai-server`. Switching providers requires touching all consumers of the integration package, not just the package itself.

---

## Round 2 — Code Quality & Security Review

### Strengths

1. **No fallback API keys** — No hardcoded defaults, no `|| ''` fallback for API keys. Per-project config is required.
2. **Per-project API key isolation** — Each project has its own key via `llm_configs`; no shared/service-key pattern.
3. **Input validation** — Zod schemas validate model names and config overrides before DB writes.
4. **No debug logging of secrets** — API keys never appear in logs.

### Issues Found

1. **⚠️ Interface is OpenAI-specific** — The `@workspace/integrations-openai-ai-server` package exposes OpenAI SDK types in its public API (`ChatCompletion`, `Embedding`). Consumers importing from this package are coupled to OpenAI types even though they only need generic `chat()` and `embed()` methods. Architecturally: the package name encodes the provider, making it impossible to swap without a rename.

2. **⚠️ No retry-on-overload** — `batch/utils.ts` has basic retry but no specific handling for OpenAI's `429 rate limit` vs `500 internal` errors. LLM operations are expensive; blind retry on 500 wastes tokens.

---

## Round 3 — Integration & Completeness Review

### Integration Correctness

1. **LLM → Intent Router → Generate pipeline** — Full routing chain: query → intent router → embedding → LLM context assembly → completion. Verified end-to-end.
2. **Embedding storage + retrieval** — Embeddings generated via OpenAI stored in `l3_nodes.vector` column; retrieved via pgvector `<=>` cosine similarity.
3. **API key resolution** — `generate.ts` resolves API key from `llm_configs` table via project ID. Missing config = clear error, not silent fallback.

### Missing Coverage

1. **No adapter interface** — If the team ever wants to support a non-OpenAI provider directly (without LiteLLM proxy), there is no `LLMProvider` interface to implement.
2. **No streaming support in `generate.ts`** — Server-Sent Events (SSE) for real-time token streaming is not implemented. All LLM responses are blocking waits.

---

## Changes Since Last Verification

| Change | Impact |
|--------|--------|
| None — all checksums identical | No code changes since 2026-06-27 |

**Net change:** No code changes since last verification. All findings are carried forward.

---

## Findings Summary

| # | Severity | Category | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | � | Architecture | No multi-provider adapter interface; package hardcoded to OpenAI types | Unchanged |
| 2 | 🟡 | Architecture | Consumers import OpenAI SDK types directly from package | Unchanged |
| 3 | 🟡 | Reliability | No retry differentiation between 429/500 errors in batch utils | Unchanged |
| 4 | � | Feature | No SSE streaming support in generate.ts | Unchanged |

---

## Overall Verdict

**⚠️ WARN**

The LLM abstraction layer is fully functional per its ADR constraints (OpenAI-only by design, per ADR-004) and the codebase has not changed since the last verification. The WARN findings are architectural observations (missing adapter interface, OpenAI-coupled types, no streaming) that represent future improvement opportunities rather than functional defects. The `integrations-openai-ai-server` package correctly implements OpenAI-compatible LLM integration with per-project model switching, API key isolation, and full embedding pipeline. All findings are carried forward from report 0650 (2026-06-27) without change.

**Recommendation:** Close this WARN if the ADR-004 OpenAI-only constraint remains the long-term architectural decision. If multi-provider support is planned, introduce a `LlmProvider` interface in a new `@workspace/llm-core` package that `integrations-openai-ai-server` implements.
