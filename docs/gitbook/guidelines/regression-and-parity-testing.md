# Regression, Parity, and Environment Testing

This document outlines the testing strategy for the interface layers (CLI, MCP, VS Code Client) to ensure consistency, backward compatibility, and strict separation from the core business logic.

## 1. Interface and Core Separation

The presentation layers (CLI, MCP, etc.) MUST NOT contain business logic.

- **Unit Tests for Interfaces:** Focus solely on verifying that user inputs (arguments, flags, prompts) correctly map to the Core API arguments.
- **Exit Codes & Standard I/O:** E2E tests for the CLI must verify that expected errors yield correct standard error outputs and non-zero exit codes (e.g., `Exit Code 1`), failing gracefully without leaking deep stack traces to the user.

## 2. Single File, Single Command (Granularity of Tests)

**Rule:** _A single test file must test only one specific command or feature._

- **Structure:** The test suite must be broken down into 10-20 independent files (e.g., `commands/init.test.ts`, `commands/sync.test.ts`, `commands/mcp.test.ts`). Each command and its derivatives are tested in total isolation.
- **Base Environment Provider:** Use a centralized sandbox/fixture provider (`test/support/sandbox.ts`) to spin up the exact environment needed for the test, ensuring tests do not interfere with each other.

## 3. Black-Box Side-Effect Verification (No Fake Tests)

**Rule:** _Tests must verify the actual correctness of the system's side-effects (e.g., database states, file creations, exact output matches against known baselines), not just assert that it didn't crash._

- **Avoid Implementation Coupling:** Do not write tests just to "pass" the current framework. If `docuvia init` is called, the test must physically open `.docuvia/local.db` using a raw SQLite client, assert that the tables (e.g., `l1_tags`, `l2_nodes`, `l3_nodes`) exist, and verify the schema matches the expected standard (comparing against architectures like `graphify` or `gitnexus`).
- **Real-World Scale:** Tests should be capable of running against real-world, complex project fixtures (e.g., a mock of `vscode` or a massive monorepo) to prove the CLI logic handles scale, dependencies, and complex routing properly.

## 4. Parity Testing (The Alignment Rule)

**Rule:** _CLI commands, MCP tool names, and VS Code command IDs must align conceptually and structurally._

- **Automated Drift Detection:** Create reflection-based or map-based tests that compare the available commands in the CLI against the registered tools in the MCP Server.
- If a feature is added to the CLI (e.g., `export-data`), the Parity Test MUST fail until the equivalent capability is exposed via MCP, forcing developers to maintain feature parity across all AI and human interfaces.

## 5. Isolated Sandboxes (Clean Environments)

Tests must NEVER run against or pollute the developer's actual workspace or the production `.docuvia/local.db`.

- **File System Sandbox:** Local command tests (e.g., `init`, `analyze`, `extract`) must dynamically generate temporary directories (e.g., via `fs.mkdtemp`), initialize mock git repositories, and seed dummy source code files.
- **Network/DB Sandbox:** For tests involving network syncing (`docuvia sync`) or server interactions, use throwaway Docker Compose environments to emulate the backend API and PostgreSQL instances reliably.

## 6. Target Errors & Edge Cases

Always test how the system behaves when the target state is invalid. The interface must degrade gracefully:

- **Missing Targets:** Executing a command on a missing file (e.g., `docuvia analyze non_existent.ts`) should yield a clear "File not found" error, not a crash.
- **Malformed Content:** Passing a file with severe syntax errors to the AST analyzer should be skipped or logged without halting the entire batch process.
- **Uninitialized State:** Querying an empty or non-existent knowledge graph must cleanly prompt the user to run `docuvia init`.

## 7. Legacy Upgrades & Migrations

Because the CLI maintains local state (e.g., local SQLite databases in the user's workspace), users will inevitably run newer CLI versions against older local data structures.

- **State Migration Tests:** Seed the sandbox with a legacy version of `local.db` (e.g., schema v1) and execute a current CLI command.
- **Verification:** Assert that migrations run automatically and successfully, preserving existing knowledge graphs and user settings without destructive data loss.
