# Docuvia2 `doctor` Reliability & Health Check Enhancement In-Depth Analysis

> **Context**: In-depth technical analysis for "Priority 4: Enhance `doctor` Reliability Checks" in the Phase 1 execution strategy.
> **Date**: 2026-07-16
> **Status**: Independent Analysis Report

---

## 1. Background: The Fear of Silent Failures

Docuvia2 is positioned as a knowledge graph accumulation tool that "executes silently in the background". This brings a hidden danger: **If it breaks in the background, users will never notice.**
The current Git hook invocation is `npx --no-install docuvia ...`. If `docuvia` does not exist in the project's `node_modules`, npm will throw an error and exit directly. But because the hook usually redirects stdout/stderr to `/dev/null` or flashes by quickly, developers have no way of knowing the graph has stopped updating.
The `doctor` command must serve as the ultimate defense line for system health, filling these unknown black holes.

## 2. Hook Execution & Binary Resolvability Checks

The current `doctor` only checks the SQLite database, WAL size, and Git Remote. We must expand the following checkpoints:

### 2.1 Hook Script Existence and Correctness

- Read `.git/hooks/post-commit`.
- Check if it contains `docuvia analyze` (or the old `snapshot`). If not, issue a `WARNING` advising the execution of `docuvia init` to reinstall.

### 2.2 Local Binary Resolvability

- This is the core pain point defense. `doctor` should simulate the Hook's execution environment, attempting a dry run of `npx --no-install docuvia --version` using `require.resolve` or `child_process.execSync`.
- **Validation Logic**:
  - If it returns successfully: Represents a healthy Hook environment.
  - If it returns "command not found" or missing modules: Issue a `CRITICAL` error. This indicates the user might have removed the globally installed docuvia, or the current repo is missing corresponding dependencies. Must strongly remind the user to fix it.

## 3. LLM Endpoint Health Checks

With Phase 1 (Tier C) and heavy reliance on L3 extraction, the system's dependence on LLM endpoints increases significantly. Local Ollama and remote OpenAI/Claude both need monitoring.

### 3.1 Abstracted Connectivity Test (Ping Test)

- Implement a lightweight `ping()` or `checkHealth()` method via the LLM-002 `CLIProxyAPI` in `lib/ui-core`.
- **Flow**:
  1. Read `DOCUVIA_AI_PROVIDER` and endpoint URL.
  2. If Local LLM, perform a lightweight HTTP GET against `http://localhost:11434/api/tags` (for Ollama).
  3. If Remote API, send a minimum cost Dummy Prompt with Max Token = 1 (e.g., "Respond with 'OK'").
  4. Catch specific errors like `ECONNREFUSED`, `401 Unauthorized`, `429 Too Many Requests`.

## 4. Implementation Details & UX Considerations

- **Spinner Feedback**: In `artifacts/cli/src/commands/doctor.ts`, add independent Spinner phases for these two new checks. For example: `⠋ Verifying Git Hook configuration...`, `⠋ Pinging AI Inference Endpoint...`.
- **Audit Trail**: If a check fails, besides displaying a red `✖` in the terminal, it must use `logger.error()` to write detailed Stack traces and HTTP Status Codes into `.docuvia/logs/doctor.log`, which is crucial for post-mortem debugging.
- **Graceful Degradation**: If the LLM check fails, the `doctor` summary report should explicitly state: "L2 AST parsing can still operate normally, but L3 knowledge extraction will be paused and queued until the network is restored." This reflects the architectural resilience of graceful degradation (PLAT-002).
