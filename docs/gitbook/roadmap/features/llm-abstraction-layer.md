# LLM abstraction layer

- **Status**: ⚠️ WARN
- **Phase**: Phase 1: Core API & Database (The Metabolism Engine)
- **Evidence / Verification Target**: `lib/llm-orchestrator/src/orchestrator.ts`, `lib/llm-orchestrator/src/{openai,anthropic,gemini}.ts` — transport adapters exist for all three providers; verify per-project provider switching and production wiring before upgrading past WARN
- **ADR**: [ADR-026](../../adr/ADR-026-multi-provider-llm-abstraction.md)

## Implementation Details

This feature is anchored by the following core components:

[`lib/llm-orchestrator/src/orchestrator.ts`](../../../../lib/llm-orchestrator/src/orchestrator.ts) — Thin Transport orchestrator with `openai.ts`, `anthropic.ts`, and `gemini.ts` provider transports

### Architecture Flow

```mermaid
graph TD
    Client[Client / Trigger] --> |Request| API[API Server]
    API --> |Process| Engine[Metabolism Engine]
    Engine --> |Read/Write| DB[(PostgreSQL)]
    Engine -.-> |Generate| LLM[LLM Abstraction]
```

### Component Description

- **Core Logic**: Handled primarily within the target files linked above.
- **State Management**: Persists or queries state directly via the defined interfaces.

## Testing & Verification

- Run `pnpm test` in the relevant workspace.
- Validate the behavior locally using `docuvia` CLI or the VS Code Extension.
- Check the [Regression & Parity Testing](../../guidelines/regression-and-parity-testing.md) guidelines.
