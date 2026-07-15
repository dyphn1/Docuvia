# Docuvia AI Memory Router

This directory contains consolidated learnings, architectural decisions, and error boundaries from completed AI tasks. It acts as the long-term memory for the Agentic OS.

## Core Operating Directives

- **Break the Loop on Repeated Failures:** When tests fail or errors occur continuously (more than 2-3 times in a row), DO NOT stubbornly repeat the same steps or brute-force minor tweaks. **Stop, step back, and rethink the approach.** Look for underlying systemic issues, consider if the testing methodology itself is hiding the real error (e.g., swallowed stack traces in CLI subprocesses), and switch tactics or debugging strategies.

## Memory Categories

- **[Architecture & Design](architecture.md)**: Docuvia2's verified package layout, the `GraphStore` memory layer, the composition-root DI convention, and the schema single source of truth.
- **[Common Errors & Traps](common_errors.md)**: Recurring bugs, API gotchas, and specific coding anti-patterns to avoid.
- **[Conventions & Best Practices](conventions.md)**: Project-specific standards for documentation, testing, and implementation.
- **[Development Guardrails](development_guardrails.md)**: Two-pass self-audit loop and positive reference patterns for virtual contracts, constants, database configuration, and quality gates.
- **[Testing & Quality Gates](testing_and_quality.md)**: Test boundaries and observed test patterns.
- **[Adversarial Workflow](workflow.md)**: Task classification, adversarial debate tiers, and multi-agent coordination rules.
