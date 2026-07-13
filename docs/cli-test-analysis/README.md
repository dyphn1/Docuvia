# CLI Command Tests Analysis Report

Based on a detailed review of the unit tests for the 14 CLI commands in the `Docuvia2` project, the current test suite relies heavily on shallow mocking and string matching. It lacks deep integration testing, edge-case coverage, and verification of complex states. 

Below is a summary of the 7 core issues identified across the test suite, aligned with the AI Harness requirements:

## 1. Incomplete Functionality (Shallow Verification)
Tests mostly verify if an API function like `docuviaApi.analyze()` was called and if the process exited correctly. 
- **Concrete Example**: In `status.unit.test.ts`, the `logger.onLog` event listener is registered to update the spinner text, but the test never simulates a log event or asserts that `spinner.text` actually changes.
- **Action**: Use `vi.spyOn` or mock event emitters to verify that side-effects like UI updates happen when background tasks emit progress logs.

## 2. Missing Language Support (Hardcoded English Strings)
The assertions are hardcoded to match English text, such as `expect.stringContaining("Project initialized successfully")`.
- **Concrete Example**: In `init.unit.test.ts`, the assertion checks for the string `"13 of 4236 files failed to parse"`. If the `UI_MESSAGES` constant is translated into another language (e.g., Chinese or Spanish), this test will immediately fail.
- **Action**: Assert against the imported `UI_MESSAGES` constants rather than raw string literals.

## 3. Overly Simple Examples / Lack of Project Complexity
Mocks return overly simplified objects that do not represent real-world scale or complexity.
- **Concrete Example**: In `impact.unit.test.ts`, the mock returns a `blastRadius` array with a single element: `[{ name: "caller", type: "module" }]`. This doesn't test how the CLI formats and outputs a blast radius of 5,000 files, which could cause terminal buffer overflows or unreadable output.
- **Action**: Use complex fixtures or large mock datasets to simulate realistic, massive codebases.

## 4. Happy Path Only / No Invalid Parameter Checks
Error handling is only tested via simple `mock.mockRejectedValue(new Error("boom"))`.
- **Concrete Example**: In `sync.unit.test.ts`, there is no test verifying what happens if `process.env.DOCUVIA_API_URL` is a malformed URI instead of undefined, or if `commitSha` exceeds normal length limits. 
- **Action**: Introduce "Sad Path" tests that explicitly pass invalid arguments, malformed data, or simulate OS-level permissions errors (`EPERM`, `ENOENT`). We MUST check ALL parameters, ALL inputs and outputs, and ALL supported possibilities. This is non-negotiable for comprehensive testing.

**Crucial Rule**: We MUST check ALL parameters, ALL inputs and outputs, and ALL supported possibilities for this command. The current tests only scratch the surface and fail to exhaustively verify the command behavior across different configurations and edge cases.

## 5. No Multi-Language Parsing or Real Database Verification (API Mocked Out completely)
Because `@workspace/ui-core` is mocked out via `vi.mock()`, the tests never run the actual logic that touches the disk, parses code, or writes to the database.
- **Concrete Example**: In `init.unit.test.ts`, the tests never verify if the AST parsers succeed across all supported languages. They also never verify if the `.docuvia/local.db` actually contains the correct data or if the knowledge branch is correctly populated. If a language parser silently fails or returns an empty DB, the CLI test still reports 100% success.
- **Action**: Add end-to-end integration tests that run against real fixtures containing *all* supported languages. Explicitly assert the correctness of the generated database contents and knowledge branches.

## 6. No Command Combination Checks (Concurrency Issues)
Commands are tested in isolation. There is no verification of how commands behave when run concurrently or sequentially.
- **Concrete Example**: What happens if `cleanCommand` is executed while a `syncCommand` is still in progress in another process? The tests don't verify if Sqlite `SQLITE_BUSY` errors are handled gracefully.
- **Action**: Write integration scenarios that simulate concurrent execution or locked file states.

## 7. No Consideration for Idempotency (Second Run Behavior)
The tests don't verify what happens if a command is run multiple times.
- **Concrete Example**: In `init.unit.test.ts`, there is no test for running `docuvia init` on a project that is *already* initialized. Does it overwrite? Does it fail? Does it skip? The test suite is silent on this.
- **Action**: Add explicit test cases for idempotency (e.g., `it("should handle second execution correctly by skipping existing DB")`).

---

**Individual Command Analysis Reports:**
- [`analyze.md`](./analyze.md)
- [`clean.md`](./clean.md)
- [`doctor.md`](./doctor.md)
- [`export-topology.md`](./export-topology.md)
- [`hydrate.md`](./hydrate.md)
- [`impact.md`](./impact.md)
- [`init.md`](./init.md)
- [`query.md`](./query.md)
- [`review.md`](./review.md)
- [`snapshot.md`](./snapshot.md)
- [`status.md`](./status.md)
- [`sync-knowledge.md`](./sync-knowledge.md)
- [`sync.md`](./sync.md)
- [`uninstall.md`](./uninstall.md)
