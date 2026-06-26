# Verification Report: VS Code Local SQLite Divergence

- **Date**: 2026-06-26
- **Phase & Item**: Phase 8 - Standalone Engine
- **Target File**: `KnowledgeStore.ts`, `extension.ts`
- **Status Update Required**: ❌ ERROR

### Description of Failure

There is a severe architectural divergence between the documented "VCS-based Knowledge Evolver" and the actual codebase.

The architecture mandates that the VS Code client uses a Local SQLite database (`.docuvia/local.db`) to serve as the **Local HEAD Index** (supporting CQRS and the AST Microkernel IPC).

However, `artifacts/vscode-client/src/KnowledgeStore.ts` and `artifacts/vscode-client/src/extension.ts` (`initProject`) are completely missing SQLite integration. They still initialize and parse the legacy `.docuvia/*.yaml` files (`l1_tags.yaml`, `l2_modules.yaml`, `l3_router.yaml`).

### Recommended Fix

1.  **Refactor `extension.ts`**: Update `initProject` to scaffold a `.docuvia/local.db` database using `better-sqlite3` and `drizzle-orm` (leveraging the schema from `@workspace/cli`). Stop scaffolding legacy YAML files.
2.  **Refactor `KnowledgeStore.ts`**: Rip out the YAML parsers (`parser.ts`) and replace them with direct SQLite `SELECT` queries to populate the `KnowledgeGraphSnapshot`.
3.  **Align with CLI**: The `query local` CLI command already writes/reads the correct SQLite schema. The VS Code client must be brought up to speed to consume this same schema.
