---
id: PLAT-003
title: Remote Sync Technology Provider
status: accepted
date: 2026-07-12
domains: [platform]
supersedes: []
superseded_by: []
---

# Remote Sync Technology Provider

## Context
During the implementation of the `sync` command, we needed to establish the first "Technology Provider" that calls an external service (a remote HTTP API). We needed a standard pattern for handling timeouts, error wrapping, and configuration injection without violating the Virtual Contracts architecture.

## Decision
We established the `FetchRemoteSyncClient` (`lib/remote-api`) as the template for remote Technology Providers:
1. **Timeout**: Enforce a strict 30s timeout on all external calls.
2. **Error Wrapping**: Wrap all failures in a `DocuviaError`. Handle three specific failure modes: 
   - Network/connection failures.
   - Non-2xx HTTP responses.
   - JSON parsing failures.
3. **Configuration Injection**: Use `docuviaMemory` to inject configuration (like API URLs or tokens). Providers must NOT access `process.env` directly.

## Consequences
- Establishes a robust, predictable pattern for all future external API integrations.
- Prevents unhandled promise rejections and hung processes due to hanging network calls.
- Keeps implementations pure and testable by injecting configuration rather than relying on global environment variables.
