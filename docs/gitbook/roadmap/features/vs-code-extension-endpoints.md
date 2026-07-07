# VS Code Extension Endpoints

- **Status**: ⚠️ WARN
- **Phase**: Phase 5: Local-First VS Code Client & Web UI
- **Evidence / Verification Target**: `artifacts/api-server/src/routes/extensions-vscode.ts`

## Implementation Details

This feature is anchored by the following core components:

[`artifacts/api-server/src/routes/extensions-vscode.ts`](../../../../artifacts/api-server/src/routes/extensions-vscode.ts)

### Architecture Flow

```mermaid
graph TD
    VSC[VS Code Extension] --> |Commands| Core[Core Services]
    UI[Web Dashboard] --> |REST| API[Local API Server]
    Core --> |Analyze| DB[(Local SQLite)]
    API --> DB
```

### Component Description

- **Core Logic**: Handled primarily within the target files linked above.
- **State Management**: Persists or queries state directly via the defined interfaces.

## Testing & Verification

- Run `pnpm test` in the relevant workspace.
- Validate the behavior locally using `docuvia` CLI or the VS Code Extension.
- Check the [Regression & Parity Testing](../../guidelines/regression-and-parity-testing.md) guidelines.
