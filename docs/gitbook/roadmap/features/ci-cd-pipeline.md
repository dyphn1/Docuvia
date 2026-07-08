# CI/CD pipeline

- **Status**: ⚠️ WARN
- **Phase**: Phase 1: Core API & Database (The Metabolism Engine)
- **Evidence / Verification Target**: `.github/workflows/ci.yml`

## Implementation Details

This feature is anchored by the following core components:

[`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml)

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
