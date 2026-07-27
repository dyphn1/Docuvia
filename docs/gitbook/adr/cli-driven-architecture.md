# CLI-Driven Architecture Mapping

This document adopts a **Top-Down** perspective. By starting from the CLI commands that users interact with most frequently, we map out the actual behavior of each command and the Architectural Decision Records (ADRs) that govern them. This ensures that every technical decision is rooted in a concrete product requirement rather than abstract architecture.

---

## 1. Infrastructure & Lifecycle

### `docuvia init`

- **What it does**: Creates the `.docuvia/` directory and `local.db`, **proactively injects `.docuvia` into `.gitignore` as a safety guardrail**, downloads prompt templates, installs the `post-commit` git hook, and finally writes to `init.log`. It absolutely does not touch any machine-global configurations.
- **Corresponding ADRs**:
  - [IFCE-004] Explicit Interactive Opt-In (Confirmation prompt only fires with `--interactive`/`-i`; supersedes IFCE-001's TTY auto-trigger)
  - [IFCE-002] Strict Repo-Scoped Boundaries (Strictly prohibits writing to global configurations)
  - [IFCE-003] Persisted Structured Command Log (Writes to `init.log`)
  - [PLAT-004] Zero-Interruption Invisible Indexing (Installs the Git Hook to achieve invisible indexing)
  - [STOR-002] SQLite as Ephemeral Query Engine (Protects `.docuvia` from entering the main Git tree)

### `docuvia clean` / `docuvia status`

- **What it does**: `clean` wipes the contents of the SQLite database (can append `--logs` to also delete logs); `status` reads and displays the number of nodes and relationships currently in SQLite.
- **Corresponding ADRs**:
  - [STOR-002] SQLite as Ephemeral Query Engine (The DB is disposable and can be wiped at any time)
  - [IFCE-003] Persisted Structured Command Log (Provides the `--logs` cleanup option)

---

## 2. Parsing & Knowledge Graph Construction (Ingestion)

### `docuvia analyze [path]`

- **What it does**: Scans files and calculates the Git Blob Hash to use as a cache key. Invokes `lib/ast-core` to parse the source code, extracts L2 nodes, and updates both SQLite and Git.
- **Corresponding ADRs**:
  - [STOR-001] Git Branch as Sole Source of Truth (Analysis results ultimately land in Git)
  - [STOR-004] Git Blob-Native Identity (Uses content hashing to prevent checkout thrashing)
  - [GRPH-003] Unified AST Microkernel (Shared AST parsing engine)
- **Deferred Scope**: Currently does not implement LLM extraction of L3 nodes. The underlying multi-provider transport is settled in [llm/LLM-002] (bridges to CLIProxyAPI, superseding [llm/LLM-001]); an extraction-specific ADR is still pending.

### `docuvia snapshot`

- **What it does**: Reads the entire SQLite state, serializes it to JSONL and Markdown, and exports it to the `docuvia-knowledge` orphan branch. It utilizes a Continuous Merge strategy to stack history, writes the first 7 characters of the original commit into the commit message for fast `git log --grep` reverse lookups, and automatically resolves conflicts by favoring the latest state.
- **Corresponding ADRs**:
  - [STOR-001] Git Branch as Sole Source of Truth (The final landing zone for data, preserving history, preventing conflicts, and enabling reverse lookups)
  - [STOR-002] SQLite as Ephemeral Query Engine (One-way read-only export)
  - [STOR-003] JSONL + Granular Markdown (The export format)

---

## 3. Retrieval & Analysis

### `docuvia query <search_query>`

- **What it does**: Performs a keyword search and 1-hop neighbor retrieval via SQLite FTS5, and packages the results into a `<docuvia_context>` XML block.
- **Corresponding ADRs**:
  - [RETR-001] Heuristic Keyword Query Only (Pure keyword search, no LLM invocation)
  - [RETR-002] Context Block for Prompt Injection (XML guardrail block)
  - [RETR-003] Local Vector Search Deprecated (No local vector search available)
  - [GRPH-005] Read-side Query Layer (The shared underlying read layer)

### `docuvia impact <target>` / `docuvia review`

- **What it does**: Performs a single-hop dependency reverse-lookup within SQLite for modified files or targets as a fast Heuristic Filter. It explicitly dictates that an LSP must be used to guarantee the absolute precision of the final dependencies.
- **Corresponding ADRs**:
  - [IMPT-001] SQL Single-hop Blast Radius (Fast heuristic query)
  - [IMPT-002] LSP Escalation for Absolute Quality (AST + LSP + LLM Tri-Layer architecture, prioritizing quality)
  - [GRPH-005] Read-side Query Layer

### `docuvia export --topology`

- **What it does**: Reads the entire graph via the Read-side Query Layer and generates static HTML.
- **Corresponding ADRs**:
  - [GRPH-004] Cross-Project L1 Tag Linking (Parses cross-project boundaries)
  - [GRPH-005] Read-side Query Layer (Warning: This command carries an OOM risk in massively large projects)

---

## 4. External Integration

### `docuvia sync`

- **What it does**: Initiates an HTTP request via the `FetchRemoteSyncClient`, enforcing a 30-second timeout and strictly wrapping failures in `DocuviaError`.
- **Corresponding ADRs**:
  - [PLAT-003] Remote Sync Technology Provider (Establishes the template for outbound connections)

### `docuvia mcp`

- **What it does**: Starts the Stdio server, directly exposing the core functionalities (which share the exact same `@workspace/core` logic as the CLI) to Cursor/Claude.
- **Corresponding ADRs**:
  - [IFCE-003] Persisted Structured Command Log (Notes that `mcp` is a long-running process and does not apply to one-shot logging).
