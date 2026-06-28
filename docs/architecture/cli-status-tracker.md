# CLI & Core API Parity Status

This document tracks the implementation status of CLI commands, their alignment with the Shared Core API (`@workspace/core`), and parity across other presentation layers (MCP, VS Code).

## Implementation Matrix

| Command | Core Service Dependency | API Alignment | MCP Tool Exists | VS Code Parity | Status / Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `init` | `InitService` | ✅ Valid | ✅ `docuvia_init` | ✅ `docuvia.initProject` | Well-aligned. Now uses non-intrusive Git plumbing commands. |
| `analyze` | `AnalyzeService` | ✅ Valid | ✅ `docuvia_analyze` | ✅ `docuvia.startExplore` | Evolving to support full AST scanning via Worker Pool. |
| `extract` | `ExtractService` | ✅ Valid | ✅ `docuvia_extract` | ✅ `docuvia.addDecision` | Well-aligned. |
| `query` | `QueryService` | ✅ Valid | ✅ `docuvia_query_local` | ✅ Chat `query` | MCP uses `QueryService.query()` natively. |
| `clean` | `CleanService` | ✅ Valid | ✅ `docuvia_clean` | ❌ Missing | Core service is instantiated properly with `workspaceRoot`. MCP tool added. |
| `status` | `StatusService` | ✅ Valid | ✅ `docuvia_status` | ❌ Missing | Core service is instantiated properly with `workspaceRoot`. MCP tool added. |
| `detect-changes`| `ChangeDetectionService`| ✅ Valid | ✅ `docuvia_detect_changes` | ❌ Missing | Core service is instantiated properly with `workspaceRoot`. MCP tool added. |
| `sync` | `SyncService` | ✅ Valid | ✅ `docuvia_sync` | ⚠️ Semantic Drift | Logic extracted into `SyncService` cleanly. MCP tool added. VS Code uses `refresh` differently. |

## Architectural Findings & Next Steps

1. **Core API Encapsulation (ADR-021) - ✅ COMPLETED**
   - Extracted `sync` logic from `cli.ts` into a new `SyncService` inside `@workspace/core`.
   - Refactored `mcp/server.ts` to call `QueryService.query()` directly instead of relying on `queryCommand` and monkey-patching `console.log`.

2. **Multi-root Workspace Isolation - ✅ COMPLETED**
   - Refactored `StatusService` and `ChangeDetectionService` to remove `static` methods. They now require a `workspaceRoot` upon instantiation to properly scope database queries and git executions, preventing single-root bias.

3. **Feature Parity - ✅ COMPLETED**
   - Implemented MCP tools for `clean`, `status`, `detect-changes`, and `sync` to achieve full parity with the CLI.

4. **Local CLI Fixes - ✅ COMPLETED**
   - Replaced LLM extraction stub with a real local LLM extraction call in the `docuvia extract` command.
   - Fixed AST Worker Pool paths.
   - Parameterized environmental variables for OpenAI models.
