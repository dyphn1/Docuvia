# Vector Index & Search

- **Status**: ✅ Done
- **Phase**: Phase 3: Agentic RAG & MCP Interfaces
- **Evidence / Verification Target**: `lib/core/src/services/intent-router.ts`

## Implementation Details

This feature is anchored by the following core components:

[`lib/core/src/services/intent-router.ts`](../../../../lib/core/src/services/intent-router.ts)

### Architecture Flow

```mermaid
graph TD
    User[User / MCP Client] --> |Query| Router{Intent Router}
    Router --> |Direct| L3[L3 Exact Match]
    Router --> |Vector| VDB[(pgvector)]
    Router --> |Graph| SQL[(Local SQLite)]
    L3 --> Context[Context Aggregator]
    VDB --> Context
    SQL --> Context
    Context --> |Return| LLM[AI Agent]
```

### Component Description

- **Core Logic**: Handled primarily within the target files linked above.
- **State Management**: Persists or queries state directly via the defined interfaces.

## Testing & Verification

- Run `pnpm test` in the relevant workspace.
- Validate the behavior locally using `docuvia` CLI or the VS Code Extension.
- Check the [Regression & Parity Testing](../../guidelines/regression-and-parity-testing.md) guidelines.
