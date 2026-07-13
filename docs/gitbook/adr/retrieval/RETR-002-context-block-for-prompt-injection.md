---
id: RETR-002
title: Context Block for Prompt Injection
status: accepted
date: 2026-07-03
domains: [retrieval]
supersedes: [legacy/ADR-010]
superseded_by: []
---

# Context Block for Prompt Injection

## Context

When performing RAG (Retrieval-Augmented Generation), retrieving raw, unfiltered content (entire Markdown files or massive JSON structures) and injecting it directly into the LLM context window is inefficient and expensive. It leads to context bloat, increased latency, and a higher chance of the LLM losing focus (the "Lost in the Middle" phenomenon).

## Decision

_(Scope significantly reduced in Docuvia2)_
We implement a `getContext()` method that retrieves specifically requested knowledge nodes and formats them into a strict `<docuvia_context>` XML block for injection into the prompt. The original plan for an advanced proxy layer with adaptive compression is currently deferred.

## Consequences

- Reduces token usage by only injecting targeted nodes.
- XML formatting helps the LLM distinguish injected context from instructions.
- Lack of advanced compression means large queries can still bloat the context window.
