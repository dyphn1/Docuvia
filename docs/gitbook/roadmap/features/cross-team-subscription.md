# Cross-team subscription

- **Status**: ⚠️ WARN
- **Phase**: Phase 6: Architecture Hardening & Security
- **Evidence / Verification Target**: `lib/db/src/schema/pg/subscriptions.ts`

## Implementation Details

This feature is anchored by the following core components:

[`lib/db/src/schema/pg/subscriptions.ts`](../../../../lib/db/src/schema/pg/subscriptions.ts)

### Architecture Flow

```mermaid
graph TD
    Req[Incoming Request] --> Auth{Auth & Locks}
    Auth --> |Valid| Proc[Process]
    Auth --> |Invalid| Reject[403 / 401]
    Proc --> DB[(Hardened DB)]
```

### Component Description

- **Core Logic**: Handled primarily within the target files linked above.
- **State Management**: Persists or queries state directly via the defined interfaces.

## Testing & Verification

- Run `pnpm test` in the relevant workspace.
- Validate the behavior locally using `docuvia` CLI or the VS Code Extension.
- Check the [Regression & Parity Testing](../../guidelines/regression-and-parity-testing.md) guidelines.
