# Smart Blast Radius (WASM Semantic Diff)

- **Status**: ✅ Done
- **Phase**: Phase 2: AST Microkernel & Semantic Diffing
- **Evidence / Verification Target**: `lib/ast-core/src/detector/semantic-diff.ts`

## Implementation Details

This feature is anchored by the following core components:

[`lib/ast-core/src/detector/semantic-diff.ts`](../../../../lib/ast-core/src/detector/semantic-diff.ts)

### Architecture Flow

```mermaid
graph LR
    FS[File System] --> |Diff / Read| AST[AST Microkernel]
    AST --> |Parse| WASM((Web-Tree-Sitter WASM))
    WASM --> |Generate| Tree[Syntax Tree]
    Tree --> |Extract| Graph[Local Graph Nodes]
```

### Component Description

- **Core Logic**: Handled primarily within the target files linked above.
- **State Management**: Persists or queries state directly via the defined interfaces.

## Testing & Verification

- Run `pnpm test` in the relevant workspace.
- Validate the behavior locally using `docuvia` CLI or the VS Code Extension.
- Check the [Regression & Parity Testing](../../guidelines/regression-and-parity-testing.md) guidelines.
