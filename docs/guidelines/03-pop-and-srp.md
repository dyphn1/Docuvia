# POP & SRP (Design Principles)

## 1. Single Responsibility Principle (SRP)
- **One Reason to Change**: Every class, function, module, or React component must have only one reason to change.
- **No God Objects**: If an object or function handles multiple unrelated tasks (e.g., database access + complex calculations + formatting), it **must be decomposed** into smaller, specialized units.

## 2. Protocol-Oriented Programming (POP) / Interface-Driven
- **Depend on Abstractions**: High-level modules should not depend on concrete implementations of low-level modules. Both should depend on abstractions (Protocols / Interfaces / Types).
- **Contract First**: When designing a service or utility, define the `interface` (the contract) first before writing the concrete implementation class.
- **Composition over Inheritance**: Build complex behaviors by composing small, focused interfaces and dependency injection rather than constructing deep, rigid class inheritance hierarchies.
