import fs from 'fs';
import path from 'path';

const outDir = 'd:/GitHub/Docuvia2/docs/cli-test-analysis';

const reports = {
  'README.md': `# CLI Command Tests Analysis Report

Based on a detailed review of the unit tests for the 14 CLI commands in the \`Docuvia2\` project, the current test suite relies heavily on shallow mocking and string matching. It lacks deep integration testing, edge-case coverage, and verification of complex states. 

Below is a summary of the 7 core issues identified across the test suite, aligned with the AI Harness requirements:

## 1. Incomplete Functionality (Shallow Verification)
Tests mostly verify if an API function like \`docuviaApi.analyze()\` was called and if the process exited correctly. 
- **Concrete Example**: In \`status.unit.test.ts\`, the \`logger.onLog\` event listener is registered to update the spinner text, but the test never simulates a log event or asserts that \`spinner.text\` actually changes.
- **Action**: Use \`vi.spyOn\` or mock event emitters to verify that side-effects like UI updates happen when background tasks emit progress logs.

## 2. Missing Language Support (Hardcoded English Strings)
The assertions are hardcoded to match English text, such as \`expect.stringContaining("Project initialized successfully")\`.
- **Concrete Example**: In \`init.unit.test.ts\`, the assertion checks for the string \`"13 of 4236 files failed to parse"\`. If the \`UI_MESSAGES\` constant is translated into another language (e.g., Chinese or Spanish), this test will immediately fail.
- **Action**: Assert against the imported \`UI_MESSAGES\` constants rather than raw string literals.

## 3. Overly Simple Examples / Lack of Project Complexity
Mocks return overly simplified objects that do not represent real-world scale or complexity.
- **Concrete Example**: In \`impact.unit.test.ts\`, the mock returns a \`blastRadius\` array with a single element: \`[{ name: "caller", type: "module" }]\`. This doesn't test how the CLI formats and outputs a blast radius of 5,000 files, which could cause terminal buffer overflows or unreadable output.
- **Action**: Use complex fixtures or large mock datasets to simulate realistic, massive codebases.

## 4. Happy Path Only / No Invalid Parameter Checks
Error handling is only tested via simple \`mock.mockRejectedValue(new Error("boom"))\`.
- **Concrete Example**: In \`sync.unit.test.ts\`, there is no test verifying what happens if \`process.env.DOCUVIA_API_URL\` is a malformed URI instead of undefined, or if \`commitSha\` exceeds normal length limits. 
- **Action**: Introduce "Sad Path" tests that explicitly pass invalid arguments, malformed data, or simulate OS-level permissions errors (\`EPERM\`, \`ENOENT\`).

## 5. No Compilation Scenarios (API Mocked Out completely)
Because \`@workspace/ui-core\` is mocked out via \`vi.mock()\`, the tests never run the actual logic that touches the disk or database.
- **Concrete Example**: \`export-topology.unit.test.ts\` tests file creation but mocks the \`docuviaApi.exportTopology\` return value. If the real API fails to compile the AST or returns an unexpected shape due to a schema change, this CLI test will still pass.
- **Action**: Add integration tests that run against a temporary physical directory without mocking the core API.

## 6. No Command Combination Checks (Concurrency Issues)
Commands are tested in isolation. There is no verification of how commands behave when run concurrently or sequentially.
- **Concrete Example**: What happens if \`cleanCommand\` is executed while a \`syncCommand\` is still in progress in another process? The tests don't verify if Sqlite \`SQLITE_BUSY\` errors are handled gracefully.
- **Action**: Write integration scenarios that simulate concurrent execution or locked file states.

## 7. No Consideration for Idempotency (Second Run Behavior)
The tests don't verify what happens if a command is run multiple times.
- **Concrete Example**: In \`init.unit.test.ts\`, there is no test for running \`docuvia init\` on a project that is *already* initialized. Does it overwrite? Does it fail? Does it skip? The test suite is silent on this.
- **Action**: Add explicit test cases for idempotency (e.g., \`it("should handle second execution correctly by skipping existing DB")\`).

---

**Individual Command Analysis Reports:**
- [\`analyze.md\`](./analyze.md)
- [\`clean.md\`](./clean.md)
- [\`doctor.md\`](./doctor.md)
- [\`export-topology.md\`](./export-topology.md)
- [\`hydrate.md\`](./hydrate.md)
- [\`impact.md\`](./impact.md)
- [\`init.md\`](./init.md)
- [\`query.md\`](./query.md)
- [\`review.md\`](./review.md)
- [\`snapshot.md\`](./snapshot.md)
- [\`status.md\`](./status.md)
- [\`sync-knowledge.md\`](./sync-knowledge.md)
- [\`sync.md\`](./sync.md)
- [\`uninstall.md\`](./uninstall.md)
`,
  'analyze.md': `# CLI Command Analysis: \`analyze\`

## 1. Incomplete Functionality
The tests only verify that \`docuviaApi.analyze\` is called and that early return works for \`targetPath\`. 
**Concrete Evidence**: In \`analyze.ts\`, \`logger.onLog\` is used to update \`spinner.text\`, but in \`analyze.unit.test.ts\`, there is zero assertion that \`spinner.text\` changes.

## 2. Missing Language Support
**Concrete Evidence**: The assertion \`expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("typescript"))\` assumes English output. If the CLI translates "Project Type: typescript" to another language, this test fails.

## 3. Lack of Project Complexity
**Concrete Evidence**: The mock returns a trivial \`{ projectType: "typescript", suggestedTags: ["typescript", "react"] }\`. It does not test how the UI renders when there are 50 suggested tags, potentially breaking terminal formatting.

## 4. No Invalid Parameter Checks
**Concrete Evidence**: \`analyzeCommand(undefined, '/root/forbidden/path')\` is never tested to see if it gracefully handles \`EACCES\` permission errors.

## 5. No Compilation Scenarios
Because \`docuviaApi.analyze\` is mocked via \`vi.mock\`, the test cannot verify if the AST parser correctly identifies project types on a real filesystem.

## 6. No Command Combination Checks
No tests verify if running \`analyze\` while \`init\` is mutating the \`.docuvia\` folder causes race conditions.

## 7. No Consideration for Idempotency
No test checks if running \`analyze\` twice caches results or causes memory scope leaks.
`,
  'clean.md': `# CLI Command Analysis: \`clean\`

## 1. Incomplete Functionality
**Concrete Evidence**: While \`docuviaApi.clean\` is mocked, the test doesn't verify if \`docuviaMemory.set(scopeId, "workspaceRoot", cwd)\` properly unregisters on a successful run beyond a simple \`deleteScopeSpy\` count.

## 2. Missing Language Support
**Concrete Evidence**: Asserts like \`expect(spinnerSucceed).toHaveBeenCalledWith(expect.stringContaining("Cleaned"))\` will break if \`UI_MESSAGES.CLEAN_SUCCESS\` is translated.

## 3. Lack of Project Complexity
**Concrete Evidence**: The mock returns \`{ deleted: true, message: "Cleaned .docuvia/local.db database." }\`. It doesn't test what happens if the database is 5GB and takes 30 seconds to clean, nor does it test partial deletion failures.

## 4. No Invalid Parameter Checks
**Concrete Evidence**: There are no tests for passing an invalid \`cwd\` path that doesn't exist.

## 5. No Compilation Scenarios
Since the actual file deletion in \`docuviaApi.clean\` is mocked, the test doesn't verify if the CLI properly handles Windows file-lock (\`EBUSY\`) errors.

## 6. No Command Combination Checks
If a background \`sync\` is holding a lock on the database, the test doesn't check if \`clean\` gracefully aborts or crashes.

## 7. No Consideration for Idempotency
**Concrete Evidence**: There is no test to verify the behavior when running \`clean\` on an already clean repository (e.g., should it say "Nothing to clean"?).
`,
  'doctor.md': `# CLI Command Analysis: \`doctor\`

## 1. Incomplete Functionality
**Concrete Evidence**: The hook verification logic manually checks \`fs.stat(claudeHooksPath)\`. The test mocks \`fs.stat\` to always resolve successfully (\`{ size: 100 }\`), but it never tests the branch where \`fs.stat\` rejects (file not found).

## 2. Missing Language Support
**Concrete Evidence**: Asserts like \`expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("All diagnostics passed."))\` rely heavily on hardcoded English text.

## 3. Lack of Project Complexity
**Concrete Evidence**: The mock returns exactly three diagnostics (\`sqlite_integrity\`, \`git_reachability\`, \`logs\`). It doesn't test UI rendering when there are 50+ diagnostics or deeply nested error details.

## 4. No Invalid Parameter Checks
**Concrete Evidence**: The \`options\` object takes \`skipDb\`, \`skipGit\`, etc., but doesn't test conflicting combinations (e.g., what if all skips are true? Does it just do nothing?).

## 5. No Compilation Scenarios
Mocking \`fs.stat\` and \`docuviaApi.doctor\` means we never test if the doctor can actually detect a corrupted physical SQLite database.

## 6. No Command Combination Checks
Doesn't test running \`doctor\` while \`hydrate\` is populating the DB.

## 7. No Consideration for Idempotency
Running \`doctor\` twice is not tested. Does it use a cache? Does it take the same amount of time?
`,
  'export-topology.md': `# CLI Command Analysis: \`export-topology\`

## 1. Incomplete Functionality
**Concrete Evidence**: The test checks if the HTML file is created and contains \`<!DOCTYPE html>\`, but it never parses the HTML to ensure the JSON graph data is actually embedded correctly inside it.

## 2. Missing Language Support
**Concrete Evidence**: Error handling asserts against \`expect.stringContaining("boom")\`. UI success messages are built with string concatenation in English (\`" nodes, " + graph.stats.linkCount\`), ignoring pluralization rules and i18n.

## 3. Lack of Project Complexity
**Concrete Evidence**: \`sampleGraph\` contains \`nodes: []\`, \`links: []\`. It doesn't test if exporting a graph with 100,000 nodes causes a \`RangeError\` during \`JSON.stringify()\` or \`renderTopologyHtml()\`.

## 4. No Invalid Parameter Checks
**Concrete Evidence**: There's no test for providing a \`--out\` path that is a file instead of a directory, which would cause \`fs.mkdirSync\` to throw \`EEXIST\`.

## 5. No Compilation Scenarios
Since \`docuviaApi.exportTopology\` is mocked, we don't test if the actual graph extraction logic fails due to TypeScript compilation errors in the target project.

## 6. No Command Combination Checks
Doesn't test what happens if the topology is exported while a heavy Git rebase is modifying the file structure.

## 7. No Consideration for Idempotency
**Concrete Evidence**: The test uses a temporary directory that is cleared after each run. It never tests running the export twice in the same directory to see if it correctly overwrites the previous files or throws.
`,
  'hydrate.md': `# CLI Command Analysis: \`hydrate\`

## 1. Incomplete Functionality
**Concrete Evidence**: The \`spinner.text\` update via \`logger.onLog\` is never triggered or asserted in the unit test.

## 2. Missing Language Support
**Concrete Evidence**: The test uses \`expect.stringContaining("dangling edge")\`. This will fail if the message is translated to another language.

## 3. Lack of Project Complexity
**Concrete Evidence**: The mock returns \`nodesLoaded: 3, edgesLoaded: 2\`. It does not test CLI behavior during a massive hydration of 500,000 nodes that might take 10 minutes (e.g., does the spinner animate correctly without blocking the event loop?).

## 4. No Invalid Parameter Checks
**Concrete Evidence**: No test verifies what happens if the CLI is run in a directory completely lacking read permissions.

## 5. No Compilation Scenarios
Mocking \`docuviaApi.hydrate\` means we don't test the actual Libgit2 binding failures or SQLite write errors that occur in reality.

## 6. No Command Combination Checks
No test for concurrent \`hydrate\` calls, which could corrupt the SQLite DB or result in SQLITE_BUSY.

## 7. No Consideration for Idempotency
**Concrete Evidence**: If \`hydrate\` is run twice, does the second run return immediately? The test doesn't simulate or assert this.
`,
  'impact.md': `# CLI Command Analysis: \`impact\`

## 1. Incomplete Functionality
**Concrete Evidence**: The \`printBlastRadius\` function uses \`console.log\` and \`ui.error\` based on risk levels. The test verifies \`spinnerSucceed\` is called, but it doesn't mock \`console.log\` to verify that the dependent modules are actually printed to the screen.

## 2. Missing Language Support
**Concrete Evidence**: Hardcoded English like \`"Risk level: "\` is used directly in \`printBlastRadius\`. Tests will fail if localized.

## 3. Lack of Project Complexity
**Concrete Evidence**: The mock returns \`blastRadius: [{ name: "caller", type: "module" }]\`. It doesn't test the console output when 2,000 files are impacted.

## 4. No Invalid Parameter Checks
**Concrete Evidence**: The test checks empty target \`""\`, but doesn't check passing a regex injection string or extremely long target names.

## 5. No Compilation Scenarios
Since it's mocked, we don't test if actual AST resolution fails to find the symbol.

## 6. No Command Combination Checks
No test for running \`impact\` while \`sync-knowledge\` is updating the graph.

## 7. No Consideration for Idempotency
No test checks if the impact query caches results for immediate subsequent runs.
`,
  'init.md': `# CLI Command Analysis: \`init\`

## 1. Incomplete Functionality
**Concrete Evidence**: The \`InitInputSchema\` validates that \`cwd\` must not be empty. However, there is zero unit test coverage in \`init.unit.test.ts\` verifying that passing an empty string throws a validation error.

## 2. Missing Language Support
**Concrete Evidence**: The test uses \`expect.stringContaining("Project initialized successfully")\`. It breaks immediately if \`UI_MESSAGES.INIT_SUCCESS\` changes or translates.

## 3. Lack of Project Complexity
**Concrete Evidence**: It mocks 4236 files requested, 13 failed. But since it's a mock, it doesn't actually test if the CLI memory footprint explodes when real initialization processes 50,000 files.

## 4. No Invalid Parameter Checks
**Concrete Evidence**: There are no tests for passing invalid characters to \`platformFilter\` or paths with non-UTF8 characters.

## 5. No Compilation Scenarios
**Concrete Evidence**: Platform \`installHooks\` methods are completely mocked. If writing to \`.cursor/hooks.json\` fails due to Windows path length limits, the test won't catch it.

## 6. No Command Combination Checks
Doesn't test what happens if \`docuvia init\` is run simultaneously in two terminals.

## 7. No Consideration for Idempotency
**Concrete Evidence**: There is no test verifying what happens when running \`init\` in an already initialized directory.
`,
  'query.md': `# CLI Command Analysis: \`query\`

## 1. Incomplete Functionality
**Concrete Evidence**: The interactive prompt \`ui.askInput\` in \`resolveQueryTarget\` is barely tested for edge cases (e.g., what if the user hits Ctrl+C?). The test also lacks assertions on \`printHumanResults\` UI formatting calls.

## 2. Missing Language Support
**Concrete Evidence**: \`formatPromptOutput\` uses English XML tags \`<docuvia_context>\`. While XML tags usually aren't translated, the UI output assertions rely on English strings.

## 3. Lack of Project Complexity
**Concrete Evidence**: \`l3\` and \`context\` mocks are tiny arrays. If a node has 1,000 callers, \`formatPromptOutput\` might generate a prompt too large for an LLM, but this is not tested.

## 4. No Invalid Parameter Checks
**Concrete Evidence**: No test for passing an invalid \`limit\` option (e.g., negative numbers or NaN).

## 5. No Compilation Scenarios
Mocks bypass actual database queries.

## 6. No Command Combination Checks
Does not test running queries while the DB is being hydrated.

## 7. No Consideration for Idempotency
Queries should be idempotent, but there are no tests ensuring that memory scope is perfectly cleaned up after 100 consecutive queries in the same process.
`,
  'review.md': `# CLI Command Analysis: \`review\`

## 1. Incomplete Functionality
**Concrete Evidence**: \`console.log("Files changed: " + result.filesChanged.length)\` is not asserted in the tests. We don't know if the output is actually printed correctly.

## 2. Missing Language Support
**Concrete Evidence**: The test asserts \`expect.stringContaining("docuvia init")\`. Localization breaks this.

## 3. Lack of Project Complexity
**Concrete Evidence**: The mock uses \`[{ file: "src/a.ts", status: "modified" }]\`. In a real PR review, there could be 500 changed files, including binary files. The test doesn't simulate this payload.

## 4. No Invalid Parameter Checks
**Concrete Evidence**: No test for passing a malformed \`baseRef\` (e.g., \`-invalid-branch\`).

## 5. No Compilation Scenarios
Since API is mocked, it doesn't test if the review command crashes when Git throws a detached HEAD error.

## 6. No Command Combination Checks
No test for running review while a Git merge is in progress.

## 7. No Consideration for Idempotency
Running review twice on the same unmodified branch is not tested.
`,
  'snapshot.md': `# CLI Command Analysis: \`snapshot\`

## 1. Incomplete Functionality
**Concrete Evidence**: Logger \`onLog\` event updating \`spinner.text\` is unverified in tests.

## 2. Missing Language Support
**Concrete Evidence**: \`expect.stringContaining("3 nodes")\` hardcodes English grammar.

## 3. Lack of Project Complexity
**Concrete Evidence**: Mocking 3 files written vs testing a real scenario where 10,000 markdown files are generated, which tests Node.js \`fs\` file descriptor limits.

## 4. No Invalid Parameter Checks
**Concrete Evidence**: Doesn't test running in a read-only directory.

## 5. No Compilation Scenarios
Mock bypasses actual file writing.

## 6. No Command Combination Checks
No test for concurrent snapshots.

## 7. No Consideration for Idempotency
**Concrete Evidence**: Running \`snapshot\` twice. Does it overwrite or fail? Unverified.
`,
  'status.md': `# CLI Command Analysis: \`status\`

## 1. Incomplete Functionality
**Concrete Evidence**: The test verifies \`ui.info\` with numbers but does not verify that \`ui.header\` was called with the correct status header text.

## 2. Missing Language Support
**Concrete Evidence**: Again, English-dependent assertions.

## 3. Lack of Project Complexity
**Concrete Evidence**: Mock returns `{ projects: 1, l2Nodes: 5, l3Nodes: 12 }`. Doesn't test number formatting for millions of nodes.

## 4. No Invalid Parameter Checks
No invalid \`cwd\` checks.

## 5. No Compilation Scenarios
Mock bypasses SQLite DB reads.

## 6. No Command Combination Checks
No test for running status while DB is locked.

## 7. No Consideration for Idempotency
No test for repeated calls.
`,
  'sync-knowledge.md': `# CLI Command Analysis: \`sync-knowledge\`

## 1. Incomplete Functionality
**Concrete Evidence**: The test covers \`no-remote\`, \`merged\`, \`up-to-date\`, but completely misses the \`fast-forwarded-local\` and \`pushed-local\` branches defined in \`STATUS_MESSAGES\`.

## 2. Missing Language Support
**Concrete Evidence**: \`expect.stringContaining("Merged")\` is hardcoded.

## 3. Lack of Project Complexity
**Concrete Evidence**: The mock returns a simple status string. It doesn't test the CLI behavior when a Git merge conflict actually occurs.

## 4. No Invalid Parameter Checks
Doesn't test running in a non-git directory.

## 5. No Compilation Scenarios
Mocks bypass actual libgit2 operations.

## 6. No Command Combination Checks
No test for syncing while impact analysis is running.

## 7. No Consideration for Idempotency
No test for running sync twice when already up to date.
`,
  'sync.md': `# CLI Command Analysis: \`sync\`

## 1. Incomplete Functionality
**Concrete Evidence**: The \`readStdin()\` function reads from \`process.stdin\`, but there are no tests that actually pipe a large mock payload into stdin to verify it works correctly.

## 2. Missing Language Support
**Concrete Evidence**: \`expect(spinnerSucceed).toHaveBeenCalledWith(expect.stringContaining("Synced 2"))\` is hardcoded English.

## 3. Lack of Project Complexity
**Concrete Evidence**: Mock returns \`{ synced: 2, skipped: 0 }\`. Doesn't simulate handling 500 skipped files with detailed warnings.

## 4. No Invalid Parameter Checks
**Concrete Evidence**: Does not check behavior if \`commitSha\` is an invalid format.

## 5. No Compilation Scenarios
Mocks bypass actual network requests. We don't test if Undici handles connection resets properly without crashing the CLI.

## 6. No Command Combination Checks
No test for concurrent syncs.

## 7. No Consideration for Idempotency
No test for re-syncing the same commit SHA.
`,
  'uninstall.md': `# CLI Command Analysis: \`uninstall\`

## 1. Incomplete Functionality
**Concrete Evidence**: It verifies \`uninstallHooks\` is called, but doesn't test what happens if one platform's \`uninstallHooks\` throws an error—does it abort the database cleanup?

## 2. Missing Language Support
**Concrete Evidence**: \`expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Unknown --platform value"))\` relies on English.

## 3. Lack of Project Complexity
**Concrete Evidence**: Mock returns successful deletion. Doesn't test partial deletion failures on locked files.

## 4. No Invalid Parameter Checks
No invalid \`workspaceRoot\` checks.

## 5. No Compilation Scenarios
Mocks bypass actual file deletion.

## 6. No Command Combination Checks
No test for uninstalling while another process is writing to the DB.

## 7. No Consideration for Idempotency
**Concrete Evidence**: No test for running uninstall twice (when files are already gone).
`
};

for (const [filename, content] of Object.entries(reports)) {
  fs.writeFileSync(path.join(outDir, filename), content, 'utf8');
}
console.log('Successfully wrote 15 analysis reports in full English with concrete evidence.');
