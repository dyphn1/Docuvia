# ADR-010: Context Compression & Proxy Layer

## Status

Accepted (2026-06-19)

## Context

As Docuvia enables deep structural code analysis via the [AST Microkernel (ADR-020)](ADR-020-unified-isomorphic-ast-microkernel.md), the next bottleneck is [LLM context window limits and API costs (ADR-009)](ADR-009-token-management.md) during code review and reasoning. We need a mechanism to intercept large code blocks destined for the LLM, compress them using the pre-calculated AST Skeletons, and seamlessly retrieve the original source code only when the LLM explicitly requests it.

## Decision

We will implement a Decoupled LLM Proxy Layer with the following design:

### 1. Multi-Tier Content Detection (Zero-Parse Proxy)

To prevent Node.js Event Loop blocking and ReDoS (Regex Denial of Service), the Proxy strictly adheres to a **Zero-Parse Principle**. It will NEVER invoke Tree-sitter dynamically. It uses a lightweight three-tier approach:

1. **Fast Path**: Extract code enclosed in explicit markers (e.g., standard markdown ` ``` ` or XML tags like `<file_content>`).
2. **Pre-filtered Heuristic Fallback**: For untagged text > 500 lines, first enforce strict line-length limits to prevent ReDoS on minified files/logs. Then, use extremely lightweight regex heuristics (density of `function`, `class`, `{`, `}`) to classify the content.
3. **No AST Validation**: We accept the risk of occasional false-positive compressions (e.g., compressing a heavily code-formatted blog post) to guarantee O(1) latency in the proxy stream.

### 2. Context Loss Mitigation & Compression Routing

Compressing raw snippets without context leads to broken ASTs. The proxy implements a dual-path routing strategy:

- **Scheme A (Context Available -> Perfect Skeleton)**: If the prompt includes a valid file path, the proxy performs an O(1) query against the local Docuvia AST Database. It replaces the code block with the pre-calculated, scope-resolved Skeleton and stores the original text in a local SQLite cache (see [Database-as-IPC (ADR-014)](ADR-014-sql-indexed-graph-and-database-as-ipc.md)).
- **Scheme B (Context Missing -> Dumb Text Crusher)**: If the prompt lacks a file path or is an unindexed delta (see [Git Blob Identity (ADR-016)](ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md) and [Orphan Branch Maintenance (ADR-017)](ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md)), we DO NOT skip compression (which would destroy Token limits). Instead, we route it to a stateless **Dumb Text Crusher**. This is a fast, indentation/regex-based folder that aggressively replaces `{ ... }` blocks with `...` without attempting semantic AST resolution. It still generates a compressed payload and an MCP ID.

### 3. Decoupled Tool Execution & TTL Eviction

To avoid the immense engineering complexity of "Proxy Streaming Hell" (handling async tool call loops and SSE mid-stream), the proxy **does not** register or intercept MCP tool calls.

- The proxy replaces the code with an ID and injects a System Prompt: _"Some code blocks have been compressed. Use the `docuvia_retrieve_original` MCP tool with the ID to read the full code."_
- The `docuvia_retrieve_original` tool is registered entirely independently by the Docuvia MCP Server directly to the [client (Cursor/Copilot) (ADR-001)](ADR-001-vscode-client-onboarding.md) running in our [Local-First Architecture (ADR-002)](ADR-002-local-first-architecture.md).
- **TTL Eviction (Security & Disk Guardrail)**: To prevent infinite disk bloat and address data retention risks, the `compressed_payloads` SQLite table (see [Database-as-IPC (ADR-014)](ADR-014-sql-indexed-graph-and-database-as-ipc.md)) enforces a strict 24-hour TTL (Time-To-Live). A [background job (ADR-008)](ADR-008-asynchronous-metabolism.md) purges expired payloads automatically.

## Consequences

- **Positive**: Drastically reduces LLM token costs by replacing large codefiles with 50-line AST skeletons. Decoupled architecture prevents the proxy from crashing the SSE stream. Scheme A/B prevents generating corrupted ASTs from context-less snippets.
- **Negative**: Requires maintaining a separate SQLite cache for intercepted payloads (`compressed_payloads`). Relies on LLM instruction-following to invoke the retrieval tool successfully.
