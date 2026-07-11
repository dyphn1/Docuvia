# Design Spirit & Core Principles

> **Guideline Protocol:** 
> These guidelines represent the "Spirit" of Docuvia2's codebase, distilled from our foundational principles. While the Architecture documents dictate *how* things connect, these guidelines dictate *how you should think* when writing the code itself.

---

## 1. Protocol-Oriented Programming (POP)

In Docuvia2, we do not think in terms of classes or inheritance hierarchies; we think in terms of **Protocols (Interfaces/Contracts)**.

*   **Contract First**: When designing a service or utility, define the `interface` (the contract) first in `lib/contracts` before writing the concrete implementation class.
*   **Depend on Abstractions**: High-level modules (`ui-core`) must not depend on concrete implementations of low-level modules (`lib/schema`). Both must depend on the abstractions.
*   **Composition over Inheritance**: Build complex behaviors by composing small, focused interfaces and dependency injection rather than constructing deep, rigid class inheritance hierarchies.

## 2. Extreme Single Responsibility Principle (SRP)

Modules, classes, and functions in Docuvia2 must do **one thing** and do it perfectly.

*   **One Reason to Change**: Every module must have only one reason to change.
*   **No God Objects**: If an object or function handles multiple unrelated tasks (e.g., database access + complex calculations + formatting), it **must be decomposed** into smaller, specialized units.
*   **The "And" Rule**: If a file has the word "And" in its conceptual description (e.g., "This module parses the AST *and* saves it"), it violates SRP. Break it apart. Orchestration (`lib/ui-core`) handles the "And". Implementation (`lib/core`) handles the "Thing".

## 3. Clean Code & DRY (Don't Repeat Yourself)

*   **No Repeated Logic**: Extract repeated logic snippets into shared utility functions within the appropriate domain.
*   **Method Complexity**: Keep methods and functions small and focused. If a method exceeds reasonable length or has high cyclomatic complexity (too many nested `if`/`for` loops), split it into private helper methods.
*   **Centralized Constants (No Magic Strings)**: Raw string literals and obscure numbers should not be scattered across the codebase. Extract shared configurations, statuses, and strings into specific `constants/` files or strictly typed TypeScript `enum` and `as const` objects.

## 4. Defensive & Immutable by Default

Assume that data passed into your functions might be malformed, especially at the boundaries of the system.

*   **Boundary Validation**: Never trust external data. Use tools like Zod for strict runtime boundary validation before the data enters the core logic.
*   **Null-Safety**: Handle `null` and `undefined` safely. Enforce the use of Optional Chaining (`?.`) and Nullish Coalescing (`??`), and use Type Guards.
*   **Immutable Structures**: Do not mutate objects passed to you. Return new objects. Use pure functions wherever possible. If a function takes an AST node, it should return a *new* transformed node, not modify the original in place.
*   **Meaningful Error Handling**: Do not swallow exceptions with an empty `catch (e) {}` block. (See our [Error Handling Architecture](../architecture/error-handling-architecture.md)).