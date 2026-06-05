# 2. Constraints

## 2.1 Technical Constraints

| Constraint                     | Value / Rule                                                                | Enforcement                                                                           |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Runtime**                    | Node.js 24+, TypeScript (strict mode), ESM modules only                     | `tsconfig.base.json` (`"strict": true`); `"type": "module"` in all package.json files |
| **Package Manager**            | `pnpm` exclusively                                                          | `preinstall` script blocks `npm` and `yarn`                                           |
| **Database**                   | PostgreSQL via Drizzle ORM only — no ORM switching                          | All schema files in `lib/db/src/schema/`; raw SQL is forbidden in application code    |
| **API Contract**               | `lib/api-spec/openapi.yaml` is the single source of truth for all API types | Hand-written fetch code or API types are prohibited                                   |
| **Generated Code (read-only)** | `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/`      | These files are Orval-generated; commit them but NEVER edit manually                  |
| **Codegen trigger**            | Must run after every change to `openapi.yaml`                               | `pnpm --filter @workspace/api-spec run codegen`                                       |
| **LLM Integration**            | OpenAI-compatible endpoint only                                             | `lib/integrations-openai-ai-server/`; no native Ollama adapter in v1                  |
| **PORT environment variable**  | API server throws an explicit error on startup if `PORT` is missing         | `artifacts/api-server/src/index.ts` startup check                                     |
| **Node.js version in CI**      | Node.js 22 in GitHub Actions (24 in production)                             | `.github/workflows/ci.yml`                                                            |

---

## 2.2 Organizational Constraints

| Constraint                        | Rule                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **AI implementation plans**       | All AI-generated implementation plans must be saved under `docs/ai_plans/` before any code is written                     |
| **VS Code extension design docs** | All VS Code extension design documents must reside under `artifacts/vscode-client/design/`                                |
| **Agent scope**                   | Planning agents (Requirement Analyzer) produce only Markdown; they must not modify source code                            |
| **No manual API types**           | Orval generates all TypeScript types and React Query hooks from `openapi.yaml`; these must never be duplicated manually   |
| **Design documentation**          | Architecture documentation lives in `docs/design/` (this directory); per-package design docs live alongside their package |

---

## 2.3 Conventions (Coding Rules)

All TypeScript source code in this repository must follow the mandatory coding rules defined in:

> **[Section 8.3 — Coding Rules](08-crosscutting-concepts.md#83-coding-rules)** of `docs/design/08-crosscutting-concepts.md`

These rules cover:

- **8.3.1** Defensive Design (early return / guard clauses)
- **8.3.2** UI Architecture: MVC (View / Controller / Model separation)
- **8.3.3** POP — Protocol-Oriented Programming (interface-first services)
- **8.3.4** OOP for UI Structures (class-based VS Code providers)
- **8.3.5** Code Style Rules (line length, function length, call-chain alignment, indentation)

---

## References

- [08-crosscutting-concepts.md](08-crosscutting-concepts.md) — Full coding rules with TypeScript examples
- [AGENTS.md](../../AGENTS.md) — Developer guide: commands, package manager rules, Node version
