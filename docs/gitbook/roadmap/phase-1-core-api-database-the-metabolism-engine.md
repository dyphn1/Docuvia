# Phase 1: Core API & Database (The Metabolism Engine)

## 🎯 Objective

Establish the core infrastructure, database models (L1/L2/L3), multi-format ingestion pipeline, and asynchronous background metabolism to process knowledge securely.

## 🛠️ Implementation Method

- **Multi-Provider LLM Abstraction:** Isolate execution loops from payload generation using a Thin Transport pattern designed to support multiple providers (OpenAI, Anthropic, Gemini) (see [ADR-026](../adr/ADR-026-multi-provider-llm-abstraction.md)). Transport adapters exist for OpenAI, Anthropic, and Gemini in `lib/llm-orchestrator` — see [LLM abstraction layer](features/llm-abstraction-layer.md) (⚠️ WARN) for verification status of per-project switching and production wiring.
- **Database:** Define entities using Drizzle ORM mapped to PostgreSQL.
- **Metabolism:** Run a heartbeat-driven worker to process heavy queues (embeddings, decay, distillation) off the main thread.

### ⚠️ Precautions

- **No In-Memory State:** Avoid storing graph states in Node.js heap. Use Database-as-IPC.
- **Graceful Degradation:** Save partial results if LLM times out.

## 📋 Feature Tracking

This phase tracks the following specific features. Click on any feature to view its real implementation details, tests, and up-to-date status.

| Feature                         | Status  | Link                                                       |
| :------------------------------ | :------ | :--------------------------------------------------------- |
| Monorepo directory layout       | ⚠️ WARN | [View Details](features/monorepo-directory-layout.md)      |
| Core DB schemas defined         | ⚠️ WARN | [View Details](features/core-db-schemas-defined.md)        |
| Logging                         | ⚠️ WARN | [View Details](features/logging.md)                        |
| LLM abstraction layer           | ⚠️ WARN | [View Details](features/llm-abstraction-layer.md)          |
| Per-project model switching     | ⚠️ WARN | [View Details](features/per-project-model-switching.md)    |
| CI/CD pipeline                  | ⚠️ WARN | [View Details](features/ci-cd-pipeline.md)                 |
| Server-Side Metabolism          | ⚠️ WARN | [View Details](features/server-side-metabolism.md)         |
| L1 Tagger                       | ⚠️ WARN | [View Details](features/l1-tagger.md)                      |
| L2 Extractor                    | ⚠️ WARN | [View Details](features/l2-extractor.md)                   |
| L3 Generator                    | ⚠️ WARN | [View Details](features/l3-generator.md)                   |
| Generate pipeline orchestrator  | ⚠️ WARN | [View Details](features/generate-pipeline-orchestrator.md) |
| Incremental update (delta-only) | ⚠️ WARN | [View Details](features/incremental-update-delta-only.md)  |
| Database Test Coverage          | 🔲 TODO | [View Details](features/database-test-coverage.md)         |
