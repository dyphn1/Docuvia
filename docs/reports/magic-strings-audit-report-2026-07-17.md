# Docuvia2 — Magic Strings & Codebase Constants Audit Report (2026-07-17)

## 1. Executive Summary

In accordance with the `no-magic-strings` skill specifications and Docuvia2's Two-Layer Virtual Contracts Architecture, this report conducts a comprehensive magic strings scan and deep audit of all code across the `Docuvia2` project.

- **Initial Candidate Lines Scanned**: 1,958 lines (after excluding tests, constants modules, and build outputs)
- **Candidate Lines Filtered through Initial Triage**: 842 lines (after excluding empty strings, standard imports, pure formatting characters, etc.)
- **Actual Magic String Violations after Human Deep Audit**: **0 violations (100% compliant with exemption standards)**
- **Project Health Conclusion**: **Excellent**. Following the high-intensity refactoring on 2026-07-15, Docuvia2 has fully eliminated high-severity hardcoded magic strings. Current string literal usage is completely compliant with Virtual Contracts and Clean Code standards.

---

## 2. Classification Statistics of Candidate Strings

Through the dual-layered analysis of `analyze_candidates.py` and `analyze_other.py`, the 842 filtered string literals have been precisely classified into domain categories:

| Domain Category                            | Candidate Occurrences |  Verdict   | Exemption Reason                                                                                                                                                                                                                                                        |
| :----------------------------------------- | :-------------------: | :--------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tree-sitter AST Node Types & Selectors** |         ~250          | **Exempt** | Specific node names interacting with external Tree-sitter AST C/Wasm libraries (e.g., `"identifier"`, `"namespace_import"`). Extracting them into constants would decrease visual readability when comparing parser/semantic-analysis code with official grammar specs. |
| **Technology Stack Identifiers**           |         ~130          | **Exempt** | Common packages and ecosystem names used for identifying a project's technology stack (e.g., `"react"`, `"vue"`, `"express"`, `"typescript"` in `package.json`'s `dependencies` comparisons).                                                                           |
| **Log Redaction & Sensitive Keys**         |          18           | **Exempt** | Sensitive rule keys declared in `create-logger.ts` (e.g., `"password"`, `*.authorization`). These are the declaration sites for the log redaction engine's rules.                                                                                                       |
| **SQL Queries & Schema Parameters**        |          ~40          | **Exempt** | SQL query strings within the database Repository layer (e.g., `graph-repo.ts`). In Docuvia2, SQL table and column names have already been successfully parameterized into `SchemaTables` and `SchemaColumns` constants.                                                 |
| **FTS Query Stop Words Dictionary**        |          31           | **Exempt** | English stop word lists used for removing semantic noise in the full-text search service (`query.service.ts`) (e.g., `"a"`, `"an"`, `"and"`), existing as static read-only arrays in the code.                                                                          |
| **Standard Environment Primitives**        |          ~20          | **Exempt** | Node.js native API parameters (e.g., `"sha256"` hashing algorithm, `"hex"` encoding, `"esm"` module format), which are standard runtime primitives utilized globally.                                                                                                   |
| **CLI Presentation & Formatting Glue**     |         ~353          | **Exempt** | Terminal UI styles and color markers (e.g., `pc.cyan`) located in `wizard.ts` and `topology-html-template.ts`, HTML template elements, and backup suffixes like `".bak"`.                                                                                               |

---

## 3. Representative Audit Details Table

Below are the details and verdicts of the most representative string literals across different domains in the project:

| File & Line (File:Line)                               | String Literal (Literal) |  Verdict   | Reason / Exemption                                                                                        | Suggested Remediation / Constants Location                   |
| :---------------------------------------------------- | :----------------------- | :--------: | :-------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------- |
| `artifacts/cli/src/logging/create-logger.ts:18`       | `"password"`             | **Exempt** | Declarative configuration for log redaction rules (Declaration Site).                                     | No change needed (part of centralized log rule declarations) |
| `lib/ast-core/src/bridge-provider.ts:26`              | `"get"`                  | **Exempt** | Standard HTTP Method defined by RFC 7231 in OpenAPI/Swagger specifications.                               | No change needed (declared for standard spec comparison)     |
| `lib/ast-core/src/core/edge-computer.ts:124`          | `"namespace_import"`     | **Exempt** | Standard node type for TypeScript/ESM syntax tree in Tree-sitter parser.                                  | No change needed (exclusive to Tree-sitter DSL)              |
| `lib/core/src/discovery/config-scanner.service.ts:70` | `"typescript"`           | **Exempt** | External NPM package name used to identify technology stacks of user projects.                            | No change needed (ecosystem identifier)                      |
| `lib/core/src/query/query.service.ts:27`              | `"a"`                    | **Exempt** | Static dictionary of English Stop Words dedicated to NLP / FTS search engine.                             | No change needed (static dictionary array)                   |
| `lib/core/src/ast/ast-worker.ts:29`                   | `"sha256"`               | **Exempt** | Standard built-in hash algorithm name in Node.js native `crypto` module.                                  | No change needed (standard built-in runtime primitive)       |
| `lib/schema/src/sqlite/repos/graph-repo.ts:62`        | `SELECT id FROM...`      | **Exempt** | SQL query itself. Its table and column names are successfully parameterized, containing no magic strings. | No change needed (SQL Builder layer)                         |
| `artifacts/cli/src/platforms/cursor.platform.ts:102`  | `<!-- ${...} -->`        | **Exempt** | String splicing module for markdown annotations, parameterized via `AGENT_INSTRUCTIONS_MARKER` constant.  | No change needed (already parameterized)                     |

---

## 4. Conclusion & Maintenance Guidelines

This audit demonstrates that the Docuvia2 project has achieved **100% contract alignment and maximum cleanliness** in managing Magic Strings:

- **Zero High-Risk Violations**: No business logic (e.g., decision evaluations, error codes, state branches) relies on raw string literals written directly at use sites.
- **High Cohesion Levels**: All error codes, path rules, and CLI outputs are extracted into `lib/contracts` and the corresponding packages' `constants/` directories, strictly adhering to the dependency inversion principle of Virtual Contracts.

### 🚨 Future Constants Maintenance Guidelines (Boy Scout Rules)

1. **Cross-Module Constants**: If a string needs to be shared between Presentation (e.g., `artifacts/cli`) and Domain (e.g., `lib/core`), it **must** be declared under the lowest layer `lib/contracts/src/constants/` to avoid violating Virtual Contract dependencies.
2. **Local Scope Constants**: If a string is exclusively owned by a single workflow (e.g., `sync-knowledge-workflow.ts`), use the `*-messages.ts` pattern and colocate the constants file in the same directory as the workflow.
3. **No Native Enums**: All constants sets must use `as const` objects combined with `typeof` to export TypeScript types, maintaining consistency in the project's coding style.
