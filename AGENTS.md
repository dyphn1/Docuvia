# Docuvia2 — AI Developer Guide

> **CRITICAL INSTRUCTION FOR ALL AI AGENTS & DEVELOPERS:**
> Docuvia2 is built on a strict, non-negotiable **Two-Layer Virtual Contracts Architecture**. Do not write a single line of implementation code without reading and understanding the architecture guides in `docs/gitbook/architecture/`.

## 🏛️ Core Architectural Mandates

1. **Virtual Contracts (`lib/contracts`)**: All implementations must map to interfaces defined here. Cross-importing between implementation libraries (`lib/schema`, `lib/ast-core`, `lib/libgit2`) is strictly forbidden.
2. **Lifecycle & State**: Implementations do not manage their own lifecycles. They self-register to `docuviaFactory`, are instantiated transiently by the Orchestration layer (`lib/ui-core`), and rely on `docuviaMemory` with UUID scoping for configuration. Do not read `process.env` in implementation libraries.
3. **Error Handling**: Do not swallow errors with empty `catch` blocks or use `console.error`. All errors must be wrapped in `DocuviaError` with a specific Error Code and thrown upwards. Only the Presentation layer (`artifacts/cli`, `mcp`) is allowed to log final unrecoverable errors.
4. **Logging**: Do not use `console.log` or `console.error` (to prevent MCP stdout corruption). Use the event-driven `logger` injected by the Orchestrator. Tech Providers (like DB or Git wrappers) are "Silent Workers" and do not receive the logger at all.
5. **Testing**: Test-Driven Development (TDD) is mandatory. Orchestration logic uses pure mocks injected via the Factory Lock, while Implementation logic uses isolated integration tests against real temporary resources.

## 📚 Required Reading

Before modifying or creating any core mechanism, you MUST read the corresponding architecture document to ensure implementation consistency:

- [The Virtual Contracts Architecture](docs/gitbook/architecture/virtual-contracts-architecture.md)
- [Application Lifecycle & State Management](docs/gitbook/architecture/application-lifecycle-and-state.md)
- [Unified Error Handling Strategy](docs/gitbook/architecture/error-handling-architecture.md)
- [Event-Driven Logging](docs/gitbook/architecture/logging-architecture.md)
- [Testing & Quality Gates](docs/gitbook/architecture/testing-and-quality-architecture.md)
- [IPC Logging Architecture](docs/gitbook/architecture/ipc-logging-architecture.md) — required before touching `worker_threads`/`child_process` code (e.g. `lib/core/src/ast/`)
