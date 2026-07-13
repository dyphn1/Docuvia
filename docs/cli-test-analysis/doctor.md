# CLI Command Analysis: `doctor`

## 1. Incomplete Functionality
**Concrete Evidence**: The hook verification logic manually checks `fs.stat(claudeHooksPath)`. The test mocks `fs.stat` to always resolve successfully (`{ size: 100 }`), but it never tests the branch where `fs.stat` rejects (file not found).

## 2. Missing Language Support
**Concrete Evidence**: Asserts like `expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("All diagnostics passed."))` rely heavily on hardcoded English text.

## 3. Lack of Project Complexity
**Concrete Evidence**: The mock returns exactly three diagnostics (`sqlite_integrity`, `git_reachability`, `logs`). It doesn't test UI rendering when there are 50+ diagnostics or deeply nested error details.

## 4. Incomplete Parameter & I/O Checks (Must test ALL parameters, inputs, outputs, and supported possibilities)
**Concrete Evidence**: The `options` object takes `skipDb`, `skipGit`, etc., but doesn't test conflicting combinations (e.g., what if all skips are true? Does it just do nothing?).

**Crucial Rule**: We MUST check ALL parameters, ALL inputs and outputs, and ALL supported possibilities for this command. The current tests only scratch the surface and fail to exhaustively verify the command behavior across different configurations and edge cases.

## 5. No Compilation Scenarios
Mocking `fs.stat` and `docuviaApi.doctor` means we never test if the doctor can actually detect a corrupted physical SQLite database.

## 6. No Command Combination Checks
Doesn't test running `doctor` while `hydrate` is populating the DB.

## 7. No Consideration for Idempotency
Running `doctor` twice is not tested. Does it use a cache? Does it take the same amount of time?
