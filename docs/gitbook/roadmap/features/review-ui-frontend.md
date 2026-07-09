# Review UI (frontend)

- **Status**: ⚠️ WARN
- **Phase**: Phase 5: Local-First VS Code Client & Web UI
- **Evidence / Verification Target**: `artifacts/kg-engine/src/pages/Review.tsx` (thin page shell — actual logic lives in its child components below)

## Implementation Details

`Review.tsx` itself is only an 11-line composition wrapper; the real logic lives in the components it renders: `ReviewTaskList` and `ReviewStatsSidebar`. Feature is real, but "Core Logic handled primarily within the target file" understates where the logic actually lives.

[`artifacts/kg-engine/src/pages/Review.tsx`](../../../../artifacts/kg-engine/src/pages/Review.tsx)

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
