---
id: IFCE-003
title: Persisted Structured Command Logging for Post-Hoc Auditability
status: accepted
date: 2026-07-11
domains: [interface]
supersedes: [legacy/ADR-036]
superseded_by: []
---

# Persisted Structured Command Logging for Post-Hoc Auditability

## Context

Originally, there was no way for a human or an AI agent to verify what a CLI run actually did after terminal output scrolled away. This is a critical gap because Docuvia is frequently invoked non-interactively and headlessly by AI coding agents.

## Decision

Every one-shot Docuvia CLI command (except the long-running `docuvia mcp` server) must persist a JSONL run log to `.docuvia/logs/<command>.log`:

1. **One JSON object per line**, each with a `ts` ISO-8601 timestamp field plus an `event` field.
2. **At minimum**, a `<command>.start` event and a `<command>.summary` event (on success) or `<command>.error` (on failure).
3. **Logging must never cause a command to fail that would otherwise succeed**.
4. **Logging lives at the service layer**, ensuring that the same service backs `docuvia mcp`'s tool calls and captures all callers.

Implemented via a shared `appendCommandLogLine` helper (`*-log-writer.ts`).

## Consequences

- **Positive**: Any command's actual behavior is inspectable after the fact — critical for headless/background AI-agent invocations.
- **Negative**: A small, ever-growing set of log files under `.docuvia/logs/` with no rotation/retention policy defined yet.
- **Non-goals**: This does not cover `docuvia mcp`'s individual tool-call-level logging or replace `logger` (pino)'s existing in-process debug logging.
