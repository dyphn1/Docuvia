# System Architecture

Welcome to the System Architecture documentation for **Docuvia2**.

This section details the fundamental design principles, structural boundaries, and architectural patterns that govern the entire workspace. As Docuvia2 represents a significant simplification and refactoring from its predecessor, understanding these core concepts is **mandatory** for all developers and AI agents contributing to the project.

## Core Architectural Guides

- **[The Virtual Contracts Architecture](virtual-contracts-architecture.md)**: The mandatory dependency inversion strategy that isolates technology implementations from business orchestration.
- **[Unified Error Handling Strategy](error-handling-architecture.md)**: The strict protocol preventing silent failures and forcing error convergence into standardized Error Codes.
- **[Application Lifecycle & State Management](application-lifecycle-and-state.md)**: Defines the bootstrap phase, asynchronous instantiation rules, and how configuration is injected via `docuviaMemory`.
- **[Event-Driven Logging Architecture](logging-architecture.md)**: Details the callback-based logging system that prevents stdout pollution and enforces structured telemetry.
- **[Strict Testing & Quality Gates Architecture](testing-and-quality-architecture.md)**: Enforces TDD, strict test isolation boundaries (Unit vs. Integration), and CI coverage ratchets.

_(More architecture guides regarding AST parsing, Knowledge Graph structure, and Database definitions will be added here as the refactoring progresses.)_
