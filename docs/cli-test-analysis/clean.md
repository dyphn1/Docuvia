# CLI Command Analysis: `clean`

## 1. Incomplete Functionality
**Concrete Evidence**: While `docuviaApi.clean` is mocked, the test doesn't verify if `docuviaMemory.set(scopeId, "workspaceRoot", cwd)` properly unregisters on a successful run beyond a simple `deleteScopeSpy` count.

## 2. Missing Language Support
**Concrete Evidence**: Asserts like `expect(spinnerSucceed).toHaveBeenCalledWith(expect.stringContaining("Cleaned"))` will break if `UI_MESSAGES.CLEAN_SUCCESS` is translated.

## 3. Lack of Project Complexity
**Concrete Evidence**: The mock returns `{ deleted: true, message: "Cleaned .docuvia/local.db database." }`. It doesn't test what happens if the database is 5GB and takes 30 seconds to clean, nor does it test partial deletion failures.

## 4. Incomplete Parameter & I/O Checks (Must test ALL parameters, inputs, outputs, and supported possibilities)
**Concrete Evidence**: There are no tests for passing an invalid `cwd` path that doesn't exist.

**Crucial Rule**: We MUST check ALL parameters, ALL inputs and outputs, and ALL supported possibilities for this command. The current tests only scratch the surface and fail to exhaustively verify the command behavior across different configurations and edge cases.

## 5. No Compilation Scenarios
Since the actual file deletion in `docuviaApi.clean` is mocked, the test doesn't verify if the CLI properly handles Windows file-lock (`EBUSY`) errors.

## 6. No Command Combination Checks
If a background `sync` is holding a lock on the database, the test doesn't check if `clean` gracefully aborts or crashes.

## 7. No Consideration for Idempotency
**Concrete Evidence**: There is no test to verify the behavior when running `clean` on an already clean repository (e.g., should it say "Nothing to clean"?).
