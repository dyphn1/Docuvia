# CLI Command Analysis: `impact`

## 1. Incomplete Functionality

**Concrete Evidence**: The `printBlastRadius` function uses `console.log` and `ui.error` based on risk levels. The test verifies `spinnerSucceed` is called, but it doesn't mock `console.log` to verify that the dependent modules are actually printed to the screen.

## 2. Missing Language Support

**Concrete Evidence**: Hardcoded English like `"Risk level: "` is used directly in `printBlastRadius`. Tests will fail if localized.

## 3. Lack of Project Complexity

**Concrete Evidence**: The mock returns `blastRadius: [{ name: "caller", type: "module" }]`. It doesn't test the console output when 2,000 files are impacted.

## 4. Incomplete Parameter & I/O Checks (Must test ALL parameters, inputs, outputs, and supported possibilities)

**Concrete Evidence**: The test checks empty target `""`, but doesn't check passing a regex injection string or extremely long target names.

**Crucial Rule**: We MUST check ALL parameters, ALL inputs and outputs, and ALL supported possibilities for this command. The current tests only scratch the surface and fail to exhaustively verify the command behavior across different configurations and edge cases.

## 5. No Compilation Scenarios

Since it's mocked, we don't test if actual AST resolution fails to find the symbol.

## 6. No Command Combination Checks

No test for running `impact` while `sync-knowledge` is updating the graph.

## 7. No Consideration for Idempotency

No test checks if the impact query caches results for immediate subsequent runs.
