---
description: "Output example for create-agent-launcher applied to a TypeScript npm/pnpm monorepo CLI project (e.g., Gemini CLI). Shows the Context Profile from project discovery and the expected generated agent content."
---

# Example: TypeScript npm Monorepo CLI (Gemini CLI)

This example shows what the Project Discovery step should extract from the project, and what the generated agent files should contain.

---

## Input: Project Discovery Findings

After reading `README.md`, `GEMINI.md` (project-specific AI notes), and `package.json`, the LLM should record this Context Profile:

```
Project Name:       Gemini CLI
Primary Language:   TypeScript / Node.js
Full Build Command: npm run build  (runs scripts/build.sh across all packages)
Local Build Command:npm run build -w packages/<package-name>
Key Source Paths:   packages/core/src/ (core AI agent logic),
                    packages/cli/src/ (CLI entry point and commands),
                    packages/vscode-ide-companion/ (VSCode integration)
AI Plan Path:       docs/ai_plans/ at the repo root
Monorepo Type:      npm workspaces
Workspace File:     package.json (workspaces: ["packages/*"])
Special Constraints:Run 'npm run lint' after build. Integration tests in integration-tests/.
```

**Key signals discovered from README.md and package.json:**
- `"workspaces": ["packages/*"]` → npm workspaces monorepo
- `"build": "scripts/build.sh"` → custom build script (not bare `tsc`)
- `"lint": "eslint ."` → ESLint configured
- Packages: `@google/gemini-cli` (CLI entry), `@google/gemini-cli-core` (core agent)
- TypeScript config at root `tsconfig.json` and per-package

---

## Output: Generated Agent Files

**`requirement-analyzer.agent.md` — Approach section:**
```markdown
## Approach

1. **Analyze Requirements**: Review the requirements. Use `search` and `read` tools to
   gather context from the relevant packages: `packages/core/src/` (core AI agent logic,
   tools, and Gemini model integration), `packages/cli/src/` (CLI entry point, commands,
   and REPL), and `packages/vscode-ide-companion/` (VSCode companion extension) as applicable.
2. **Handle Ambiguities**: Note critical ambiguities for the user; otherwise proceed.
3. **Document**: Save a detailed implementation document at `docs/ai_plans/` as
   `implement_<feature-name>.md` (e.g., `docs/ai_plans/implement_gemini_cli_auth.md`).
   Include:
   - Implementation Goals
   - Approach / Methodology
   - Detailed Implementation Steps
   - Implementation Details (classes, APIs, files, package paths)
   - Architecture Diagrams (if applicable)
```

**`backend-developer.agent.md` — full file:**
```markdown
---
name: "Backend Developer"
description: "Use when: you need to implement TypeScript/Node.js source code based on a requirement list or AI plan. This agent implements features and verifies them using 'npm run build'."
tools: [read, edit, search, execute]
---

You are an expert TypeScript/Node.js Developer working in the **Gemini CLI** monorepo.
Your primary responsibility is to implement TypeScript source code strictly based on a
provided requirement list or AI implementation document.

## Approach

1. **Analyze Requirements**: Read the provided implementation document in `docs/ai_plans/`.
   Use `search` and `read` to understand the existing codebase in the relevant packages:
   `packages/core/src/` (core agent logic and tools), `packages/cli/src/` (CLI commands
   and REPL), and `packages/vscode-ide-companion/` (VSCode integration).
2. **Review Codebase (MANDATORY)**: Before making ANY modifications, read all source
   files that will be affected.
3. **Implement**: Use the `edit` tool to modify or create TypeScript source code.
4. **Verify via Compilation/Linting — choose minimum scope**:
   - **Step 1 — Assess scope**: Did you only change files inside a single package (e.g., only
     `packages/cli/src/`)? → **Local build**. Did you change a shared type, a public export
     from `packages/core/`, or a root-level config? → **Full workspace build**.
   - **Local build** (single package, fastest):
     `npm run build -w packages/<package-name>`
     (e.g., `npm run build -w packages/cli`)
   - **Full workspace build** (when shared exports or cross-package types change):
     `npm run build` (runs the full `scripts/build.sh` pipeline)
   - **After any build**: Run `npm run lint` to ensure linting passes.
   - Prefer local build first. Escalate to full workspace only when the assessment above requires it.

## Constraints

- DO NOT modify the requirements. Your job is strictly implementation.
- You MUST thoroughly read all relevant existing files before writing any code.
- ALWAYS ensure the code compiles and lint passes before considering your task complete.
- Fix all compilation and lint errors before finishing.
```

**`agent-launcher/SKILL.md` — Project-Specific Notes section:**
```markdown
## Project-Specific Notes

- **Build verification**: `npm run build` (full workspace via `scripts/build.sh`)
  or `npm run build -w packages/<name>` for a single package
- **Lint**: Always run `npm run lint` after build
- **AI plan documents**: Save at `docs/ai_plans/implement_<name>.md` (or `fix_<name>.md`)
- **Primary language**: TypeScript / Node.js
- **Monorepo notes**: npm workspaces (`packages/*`). Key packages:
  `packages/core` (`@google/gemini-cli-core`) and `packages/cli` (`@google/gemini-cli`).
  Integration tests live in `integration-tests/`.
```

---

## Key Specificity Points

| Element | Expected in Generated Agent |
|---------|-----------------------------|
| Source paths | `packages/core/src/` (agent logic), `packages/cli/src/` (CLI commands), with role annotations |
| Build scope decision | Assess scope first; prefer `npm run build -w packages/<name>` before escalating to full build |
| Lint requirement | Explicit: always run `npm run lint` after any build |
| Package identity | `@google/gemini-cli-core` and `@google/gemini-cli` (not just "the workspace") |
| AI plan example | `docs/ai_plans/implement_gemini_cli_auth.md` (real naming pattern) |
