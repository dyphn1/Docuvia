# 06. Documentation Debt

**Severity:** 🟢 LOW
**Affected Docs:** Arc42 Chapter 00, 05, 12, 13, ADR 001-020

While these items won't directly crash the system, they will cause significant friction for team onboarding and long-term maintenance.

## 1. Overclaiming the "Agentic OS" Vision
*   **Debt:** Chapters 01 and 13 claim Docuvia is an "Agentic OS". An OS implies resource scheduling and low-level extensibility APIs, whereas the current architecture is essentially an "Enhanced RAG Knowledge Retrieval System".
*   **Proposed Fix:** Adjust the positioning to a more pragmatic description, such as "Agentic Knowledge Engine" or "AI-native Codebase Intelligence", or explicitly outline future OS-level extensibility plans in the Vision.

## 2. ADRs Lack Version Control Metadata
*   **Debt:** ADR-001 ~ ADR-020 are all marked as "Accepted" but lack creation dates, authors, and state transition histories (e.g., Proposed -> Accepted -> Superseded).
*   **Proposed Fix:** Add `Date` and `Author` fields to all ADRs, reflecting an accurate timeline of decisions.

## 3. Arc42 Structural Non-compliance (Missing Diagrams)
*   **Debt:** Arc42 Chapter 05 (Building Blocks) and Chapter 07 (Deployment) should contain Component Diagrams and Deployment Diagrams, but currently, they are just plaintext lists.
*   **Proposed Fix:** Use Mermaid to add component dependency graphs and physical deployment architecture diagrams.

## 4. Circular Definitions in Glossary
*   **Debt:** Chapter 12 contains circular definitions (e.g., A's definition includes B, and B's definition includes A) and mixes implemented terms with pure vision concepts.
*   **Proposed Fix:** Eliminate circular definitions and explicitly tag terms as `[Implemented]` or `[Planned]`.