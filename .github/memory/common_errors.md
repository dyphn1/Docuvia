# Common Errors & Traps

## CLI & Tooling

- **Unhandled Promise Rejections**: Failing to catch database connection errors in CLI entry points leads to ugly unhandled rejection crashes. Always wrap CLI commands with proper `try/catch` or `.catch()` handlers to ensure a clean error message and a non-zero exit code when infrastructure (like the DB) is missing.

## Parsing & Data Transformation

- **LLM Output / YAML Nesting Trap**: When parsing structured lists from LLM outputs, do not assume a flat array. LLMs frequently wrap arrays in parent objects (e.g., `{ project_name: "Name", tags: [...] }`). Always defensively check the input type (`Array.isArray()`) and handle nested properties before calling array methods to avoid `.map is not a function` runtime errors.

## External Processes & Pipelines

- **Command Injection via Child Processes**: NEVER pass raw user inputs (like repository URLs) to `child_process.execFile` or `exec` without strict prior validation. Always enforce Zod schemas (e.g., `^https?://`, `^svn://`) and reject malformed URIs before they reach a child-process call.
- **Missing Pipeline Deduplication**: Not hashing ingested files (e.g., SHA-256 `contentHash`) causes explosive database growth and duplicate knowledge nodes. Always hash files upon receipt and deduplicate before processing — `GraphStore`'s `files-repo.ts` (`upsertFile({ projectId, filePath, contentHash })`) is the real example of this in Docuvia2.

## Adversarial Workflow & AI Verifiers

- **Dirty Git Tree Trap for Verifiers**: When executing a long-running, multi-step AI refactoring plan, earlier valid steps will leave the Git working tree dirty. Task Verifier agents may incorrectly fail a later step if they run generic commands like `git diff` or `git status` and misinterpret the accumulated, uncommitted changes from earlier steps as unauthorized modifications. Verifiers should carefully scope their checks (e.g., specific file diffs, focused typechecks) or acknowledge accumulated state to avoid false-positive failures.
- **Redundant Field Duplication**: When an implementer extends an existing JSONL/queue record shape to satisfy a new requirement, check whether a pre-existing field already carries the same semantic meaning before adding a new one (real case: a new `tierBQueueLength`-style field duplicating an already-shipped equivalent, added during Phase 1 Slice 4). Orchestrators/verifiers should revert such additions directly rather than treating them as a legitimate new decision.

## Memory Leaks & WASM

- **WASM Memory Leaks in web-tree-sitter**: Failing to manually invoke `.delete()` on `web-tree-sitter` `Tree` and `Parser` instances results in severe WASM memory leaks. Because WASM memory is not automatically garbage-collected by the V8 JavaScript engine, always explicitly call `tree.delete()` and `parser.delete()` within your worker threads after AST extraction is complete. Ensure worker pools also implement graceful termination.

## Security & Cryptography

- **Buffer Equal Timing Leak**: NEVER use the string `.length` property for timing-safe equality checks when handling cryptographic or security-sensitive values. String length can vary for multi-byte characters, leading to crashes or information leaks. Always use `Buffer.byteLength()` before invoking `crypto.timingSafeEqual()`.
- **Redaction Path Wildcards**: When redacting sensitive fields (like API keys) in application logs, avoid shallow or exact-path matching if the token can appear in nested objects. Ensure redaction utilities support wildcard depths (e.g., `*.authorization`, `*.OPENAI_API_KEY`) to prevent accidental credential leakage in nested request payloads.
