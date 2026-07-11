# Playbook Standard

> **Guideline Protocol:** 
> To maintain consistency across our documentation and solve the issue of **Agent Inconsistency** (where AI agents implement features differently due to scattered context), all complex mechanisms MUST be documented as **Playbooks**. A well-written playbook must be universally comprehensible for both Humans and Machines (人機共通).

---

## 1. What is a Playbook?

A Playbook is a standardized operational guide for a specific mechanism or architecture pattern within Docuvia2 (e.g., "How to add a new Database Migration" or "How to parse a new AST language"). 

Instead of hiding this knowledge inside a Pull Request description or scattering it across code comments, it is centralized in a single Markdown file that AI agents can be instructed to read before executing a task.

## 2. Playbook Standard Structure

When documenting any core system, pattern, or mechanism, you **MUST** follow this strict structure:

1.  **Objective / Goal**: What this mechanism specifically tries to achieve.
2.  **Context & Architecture Links**: "Why we do this" (Link to the corresponding Architecture docs or ADRs).
3.  **File Locations & Boundary**: "Where the code lives and what NOT to touch" (Define the scope according to the Virtual Contracts architecture).
4.  **Agent Guardrails & Invariants**: Explicit rules for AI Agents and Developers (e.g., "NEVER write types manually", "ALWAYS run codegen"). Use `> **⚠️ AGENT DIRECTIVE**` blocks to ensure visibility.
5.  **Step-by-Step Implementation**: The "How-to" execution sequence.
6.  **Testing & Verification**: How to locally test and verify that the mechanism works (referencing the correct Test Lane: Unit vs. Integration).
7.  **Extensibility & Scaling**: How to expand or extend this mechanism in the future (or where absolutely NOT to extend).

## 3. Universal Documentation Rules

*   **Single Source of Truth**: Do not duplicate "how-to" knowledge in package `README.md` files. Put the detailed mechanism inside a Playbook, and link to it from `AGENTS.md` or package readmes.
*   **Agent-Readable**: Automated agents scan for specific markdown structures. Keep the headers exactly as defined above.
