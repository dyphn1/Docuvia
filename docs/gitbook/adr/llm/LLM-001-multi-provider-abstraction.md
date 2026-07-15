---
id: LLM-001
title: Multi-Provider LLM Abstraction Layer
status: superseded
date: 2026-07-06
domains: [llm]
supersedes: [legacy/ADR-026]
superseded_by: [llm/LLM-002]
---

# Multi-Provider LLM Abstraction Layer

> **Superseded by [LLM-002](LLM-002-cliproxyapi-bridge.md)**: instead of building this in-house transport layer, Docuvia2 bridges to the self-hosted [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) proxy, which already implements multi-provider OAuth and normalization.

## Context

Docuvia's value proposition relies heavily on LLM interactions (for analysis, querying, and RAG). Hardcoding to a single provider (e.g., OpenAI) creates vendor lock-in and alienates users who require local LLMs (Ollama) or alternative enterprise providers (Azure, Anthropic) for privacy or compliance reasons.

## Decision

We mandate a Multi-Provider LLM Abstraction Layer. All LLM calls must pass through a unified interface (`ILlmProvider`) that handles prompt construction, streaming, and tool execution.

_(Note: Currently deferred/tracked as Task #7 in Docuvia2. No LLM calls are currently implemented)._

## Consequences

- Requires designing a robust abstraction capable of handling varying tool-calling capabilities across different models.
- Future-proofs the application against shifting LLM market dynamics.
