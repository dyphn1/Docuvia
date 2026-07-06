# Generate pipeline orchestrator

- **Status**: ✅ Done
- **Phase**: Phase 1: Core API & Database (The Metabolism Engine)
- **Evidence / Verification Target**: `lib/core/src/services/generation/generate.service.ts`

## Implementation Details

This feature is anchored by the following core components:

[`lib/core/src/services/generation/generate.service.ts`](../../../../lib/core/src/services/generation/generate.service.ts)

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
