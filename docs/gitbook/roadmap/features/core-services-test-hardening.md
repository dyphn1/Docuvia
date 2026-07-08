# Core Services Test Hardening

- **Status**: ⚠️ WARN
- **Phase**: Phase 6: Architecture Hardening & Security
- **Evidence / Verification Target**: `lib/core/src/services/*.test.ts`

## Implementation Details

This feature is anchored by the following core components:

[`lib/core/src/services/ast-worker-pool.unit.test.ts`](../../../../lib/core/src/services/ast-worker-pool.unit.test.ts)
[`lib/core/src/services/sqlite-graph.repository.unit.test.ts`](../../../../lib/core/src/services/sqlite-graph.repository.unit.test.ts)

### Component Description

- **Core Logic**: Eliminate weak assertions like `toBeDefined()` in unit tests, ensuring robust verification of application logic.
- **State Management**: Persists or queries state directly via the defined interfaces.

## Testing & Verification

- Run `pnpm test` in the relevant workspace.
- Validate the behavior locally using `docuvia` CLI or the VS Code Extension.
- Check the [Regression & Parity Testing](../../guidelines/regression-and-parity-testing.md) guidelines.
