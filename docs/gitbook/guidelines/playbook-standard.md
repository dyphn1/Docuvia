# Playbook Standard

To maintain consistency across our documentation and solve the issue of **Agent Inconsistency** (where AI agents or developers implement features inconsistently due to scattered context), all mechanism-centric documentation MUST be structured as **Playbooks**.

A well-written playbook must be universally comprehensible for both Humans and Machines (人機共通).

## 1. Playbook Standard Structure

When documenting any core system, pattern, or mechanism in the `docs/gitbook/development/patterns/` directory, you **MUST** follow this strict 7-part structure:

1. **Objective / Goal**: What this mechanism specifically tries to achieve.
2. **Context & Architecture Links**: "Why we do this" (Links to relevant ADRs or architecture docs).
3. **File Locations & Boundary**: "Where the code lives and what NOT to touch" (Defines the scope).
4. **Agent Guardrails & Invariants**: Explicit rules for AI Agents and Developers (e.g., "NEVER write types manually", "ALWAYS run codegen").
5. **Step-by-Step Implementation**: The "How-to" execution sequence.
6. **Testing & Verification**: How to locally test and verify that the mechanism works.
7. **Extensibility & Scaling**: How to expand or extend this mechanism in the future (or where absolutely NOT to extend).

## 2. Universal Documentation Rules

- **Single Source of Truth**: Do not duplicate "how-to" knowledge in package READMEs or feature pull requests. Put the detailed mechanism inside a Playbook, and link to it from `AGENTS.md` or package READMEs.
- **Agent-Readable**: Use `> **⚠️ AGENT DIRECTIVE**` or `> **⚠️ CRITICAL RULES FOR AI AGENTS**` blocks. Automated agents scan for these specifically before operating on the codebase.
- **Update the Index**: When creating a new playbook, ALWAYS add it to:
  1. `docs/gitbook/development/patterns/README.md`
  2. `docs/gitbook/SUMMARY.md`
