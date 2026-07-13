# CLI Command Analysis: `query`

## 1. Incomplete Functionality
**Concrete Evidence**: The interactive prompt `ui.askInput` in `resolveQueryTarget` is barely tested for edge cases (e.g., what if the user hits Ctrl+C?). The test also lacks assertions on `printHumanResults` UI formatting calls.

## 2. Missing Language Support
**Concrete Evidence**: `formatPromptOutput` uses English XML tags `<docuvia_context>`. While XML tags usually aren't translated, the UI output assertions rely on English strings.

## 3. Lack of Project Complexity
**Concrete Evidence**: `l3` and `context` mocks are tiny arrays. If a node has 1,000 callers, `formatPromptOutput` might generate a prompt too large for an LLM, but this is not tested.

## 4. Incomplete Parameter & I/O Checks (Must test ALL parameters, inputs, outputs, and supported possibilities)
**Concrete Evidence**: No test for passing an invalid `limit` option (e.g., negative numbers or NaN).

**Crucial Rule**: We MUST check ALL parameters, ALL inputs and outputs, and ALL supported possibilities for this command. The current tests only scratch the surface and fail to exhaustively verify the command behavior across different configurations and edge cases.

## 5. No Compilation Scenarios
Mocks bypass actual database queries.

## 6. No Command Combination Checks
Does not test running queries while the DB is being hydrated.

## 7. No Consideration for Idempotency
Queries should be idempotent, but there are no tests ensuring that memory scope is perfectly cleaned up after 100 consecutive queries in the same process.
