# Engineering Patterns (Playbooks)

This section contains **Mechanism-Centric** playbooks.

In large codebases, knowledge often becomes fragmented—the "why" is in an ADR, the "where" is in the architecture document, and the "how" is scattered across READMEs.

These playbooks consolidate everything you need to know about a specific core mechanism into a single page. If you are modifying a core system, read its playbook first.

## Current Patterns

- **[API-First & Codegen Pipeline](api-codegen-pipeline.md)** — How we use OpenAPI, Orval, Zod, and React Query to eliminate type drift across our multi-interface system.
