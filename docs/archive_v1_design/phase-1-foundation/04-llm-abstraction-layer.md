# LLM Abstraction Layer

## Overview

Provide a unified interface to multiple LLM providers so the rest of the system is provider-agnostic.

## Implementation

`lib/integrations-openai-ai-server/src/` — exports an OpenAI-compatible client (`client.ts`, `index.ts`) used by the generate pipeline. Image and batch helpers included.

> ⚠️ **Scope Note**: The doc previously claimed "Replit skills add Anthropic, Gemini, and OpenRouter adapters." Those adapters exist as **Replit platform AI integrations** (environment-provisioned), **not** as portable code in this repository. The only provider with in-repo code is OpenAI-compatible API. Multi-provider runtime switching is not implemented within this codebase.

### Key Files

- `lib/integrations-openai-ai-server/src/client.ts` — OpenAI client instance
- `lib/integrations-openai-ai-server/src/index.ts` — exports
- `artifacts/api-server/src/routes/llm_config.ts` — per-project model config CRUD
- `artifacts/api-server/src/lib/embedding.ts` — `generateEmbedding()` using `text-embedding-3-small`

## Status

**✅ Done (OpenAI only)** — Multi-provider adapters are Replit-platform-provisioned, not portable code.

## Verification Checklist

### Code Structure & Paths

- [ ] **Confirm `lib/integrations-openai-ai-server/src/client.ts` exists** and exports a valid OpenAI client instance pointing to `AI_INTEGRATIONS_OPENAI_BASE_URL`.
- [ ] **Confirm `lib/integrations-openai-ai-server/src/index.ts` re-exports** the client and any helper utilities without circular references.
- [ ] **Confirm `artifacts/api-server/src/lib/embedding.ts` exports `generateEmbedding(text: string): Promise<number[]>`** using `text-embedding-3-small` (1536-dim).

### Per-Project Model Switching

- [ ] **Confirm `routes/llm_config.ts`** implements GET/POST/PUT/DELETE for `llm_configs` table.
- [ ] **Confirm `getModel()` in `generate.ts`** reads per-project `llm_configs` at runtime and falls back to a default model string when no config is set.

### Known Limitation

- [ ] **Document that Anthropic, Gemini, and OpenRouter** are **not** wired via in-repo adapters — they depend on Replit platform environment provisioning. Any migration to a self-hosted environment requires adding provider-specific adapters.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` to confirm the package has no TypeScript errors (note: tsconfig for this package has `"types": []` — do not add `@types/node`).
- [ ] **Build Process**: Execute `pnpm run build` to confirm the package compiles successfully.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore`** to read `lib/integrations-openai-ai-server/src/client.ts` and `lib/integrations-openai-ai-server/src/index.ts`.
  - **Validation Goal**: Confirm the client uses `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY` env vars, exports a typed OpenAI SDK instance, and contains no hard-coded provider logic for Anthropic/Gemini/OpenRouter.

### Per-Project Model Config Verification

- [ ] **Trigger `Explore`** to read `artifacts/api-server/src/routes/llm_config.ts` and the `getModel()` usage in `artifacts/api-server/src/routes/generate.ts`.
  - **Validation Goal**: Confirm that `getModel(projectId)` queries `llm_configs` by `projectId`, returns the configured model name if present, and falls back to the default model string if the row does not exist.

### Embedding Function Verification

- [ ] **Trigger `Task Verifier`** to inspect `artifacts/api-server/src/lib/embedding.ts`.
  - **Validation Goal**: Confirm `generateEmbedding()` calls OpenAI embeddings API with model `text-embedding-3-small`, returns a `number[]` of length 1536, and `cosineSimilarity()` handles zero-vector edge cases without NaN.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`** to run `pnpm run typecheck && pnpm run build`.
  - **Validation Goal**: Zero TypeScript errors and successful artifact generation. Confirm `lib/integrations-openai-ai-server` does not accidentally use `@types/node`.

### API Contract & Routing

- [ ] **Endpoint Correctness**: Verify that the endpoints are defined with correct path parameters, query parameters, request body schemas (via Zod), and return accurate JSON responses.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `lib/integrations-openai-ai-server/`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **Replit skills for Anthropic**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Gemini**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **OpenAI**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **OpenRouter**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.

### API Endpoint Validation

- [ ] **Trigger `API Architect` & `Backend Developer`**:
  - Review the route handlers and OpenAPI specifications.
  - **Validation Goal**: Ensure all edge cases (e.g., 404 Not Found, 400 Bad Request) are handled properly and that the generated client hooks match the backend signatures.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
