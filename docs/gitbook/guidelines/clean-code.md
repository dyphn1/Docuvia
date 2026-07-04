# Clean Code & DRY

## 1. Don't Repeat Yourself (DRY)

- **No Repeated Logic**: Methods should not contain excessive duplicated logic. Extract repeated logic snippets into shared utility functions.
- **Method Complexity**: Keep methods and functions small and focused. If a method exceeds reasonable length or has high cyclomatic complexity (too many nested `if`/`for` loops), split it into private helper methods.

## 2. Centralized Constants

- **No Magic Strings or Numbers**: Raw string literals and obscure numbers should not be scattered across the codebase.
- **Centralized Definition**: Extract shared configurations, statuses, and strings into specific `constants/` files or strictly typed TypeScript `enum` and `as const` objects.

## 3. Defensive Programming

- **Boundary Validation**: Never trust external data (API payloads, user inputs). Use tools like Zod for strict runtime boundary validation.
- **Null-Safety**: Handle `null` and `undefined` safely. Enforce the use of Optional Chaining (`?.`) and Nullish Coalescing (`??`), and use Type Guards.
- **Meaningful Error Handling**: Do not swallow exceptions with an empty `catch (e) {}` block. Caught exceptions must be logged or wrapped with meaningful context before re-throwing or resolving.
