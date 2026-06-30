# Common Errors & Traps

## CLI & Tooling

- **Unhandled Promise Rejections**: Failing to catch database connection errors in CLI entry points leads to ugly unhandled rejection crashes. Always wrap CLI commands with proper `try/catch` or `.catch()` handlers to ensure a clean error message and a non-zero exit code when infrastructure (like the DB) is missing.

## VS Code Extension Development

- **Multi-root Workspace Trap**: NEVER rely on `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` for file operations. In multi-root workspaces, this resolves to the wrong directory for files in subsequent roots. Always resolve the workspace root dynamically based on the target file's URI: `vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath`.

## Parsing & Data Transformation

- **LLM Output / YAML Nesting Trap**: When parsing structured lists from LLM outputs, do not assume a flat array. LLMs frequently wrap arrays in parent objects (e.g., `{ project_name: "Name", tags: [...] }`). Always defensively check the input type (`Array.isArray()`) and handle nested properties before calling array methods to avoid `.map is not a function` runtime errors.

## External Processes & Pipelines

- **Command Injection via Child Processes**: NEVER pass raw user inputs (like repository URLs) to `child_process.execFile` or `exec` without strict prior validation. Always enforce Zod schemas (e.g., `^https?://`, `^svn://`) and reject malformed URIs at the API boundary to prevent command injection.
- **Pipeline Logic Duplication**: Avoid defining pipeline phases (deduplication, DB inserts, activity logging) redundantly across multiple webhook or API routes. This causes immediate state sync issues. Centralize into a single workflow function.
- **Missing Pipeline Deduplication**: Not hashing ingested files (e.g., SHA-256 `contentHash`) causes explosive database growth and duplicate knowledge nodes. Always hash files upon receipt and deduplicate before processing.

## Memory Leaks & WASM

- **WASM Memory Leaks in web-tree-sitter**: Failing to manually invoke `.delete()` on `web-tree-sitter` `Tree` and `Parser` instances results in severe WASM memory leaks. Because WASM memory is not automatically garbage-collected by the V8 JavaScript engine, always explicitly call `tree.delete()` and `parser.delete()` within your worker threads after AST extraction is complete. Ensure worker pools also implement graceful termination.

## Security & Cryptography

- **Buffer Equal Timing Leak**: NEVER use the string `.length` property for timing-safe equality checks when handling cryptographic or security-sensitive values. String length can vary for multi-byte characters, leading to crashes or information leaks. Always use `Buffer.byteLength()` before invoking `crypto.timingSafeEqual()`.
- **Redaction Path Wildcards**: When redacting sensitive fields (like API keys) in application logs, avoid shallow or exact-path matching if the token can appear in nested objects. Ensure redaction utilities support wildcard depths (e.g., `*.authorization`, `*.OPENAI_API_KEY`) to prevent accidental credential leakage in nested request payloads.
