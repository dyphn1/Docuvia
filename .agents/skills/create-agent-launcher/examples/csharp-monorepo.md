---
description: "Output example for create-agent-launcher applied to a C# super-monorepo project (e.g., Super H2O IDE). Shows the Context Profile from project discovery and the expected generated agent content."
---

# Example: C# Super-Monorepo (Super H2O IDE)

This example shows what the Project Discovery step should extract from the project, and what the generated agent files should contain.

---

## Input: Project Discovery Findings

After reading `README.md`, `AGENT.md` (or `.github/copilot-instructions.md`), and `.gitmodules`, the LLM should record this Context Profile:

```
Project Name:       Super H2O IDE
Primary Language:   C# (.NET Framework 4.7.2)
Full Build Command: dotnet build H2O.IDE/H2O.IDE/H2OIDE.csproj  (or via ./compile)
Local Build Command:dotnet build <specific.csproj> inside the affected submodule
Key Source Paths:   H2O.IDE/H2O.IDE/ (main IDE), H2O.Common/ (shared utils),
                    H2O.Git2Sharp/ (VCS), H2O.EDK2/ (firmware), H2O.PFCM/ (platform config)
AI Plan Path:       docs/ai_plans/ at the MAIN REPO ROOT (not inside submodules)
Monorepo Type:      git submodules (level-1 only)
Workspace File:     H2O.IDE.sln
Special Constraints:Source code MUST live in submodules — never commit source to the main repo.
                    Each submodule must be level-1.
```

**Key signals discovered from README.md:**
- "In the super project, only solution file (.sln), cmake list and other collective control files are placed, and **no source code is allowed**."
- "All reference projects in the super project must be located under the git submodule."
- List of submodule directories: `H2O.IDE/`, `H2O.Common/`, `H2O.Git2Sharp/`, `H2O.EDK2/`, `H2O.PFCM/`, etc.

---

## Output: Generated Agent Files

**`requirement-analyzer.agent.md` — Approach section:**
```markdown
## Approach

1. **Analyze Requirements**: Review the requirements. Use `search` and `read` tools to
   gather context from the relevant submodule(s): `H2O.IDE/H2O.IDE/` (main IDE project),
   `H2O.Common/` (shared utilities), `H2O.Git2Sharp/` (VCS integration), and others as
   applicable. All source code lives in level-1 git submodules — never in the main repo.
2. **Handle Ambiguities**: Note critical ambiguities for the user; otherwise proceed.
3. **Document**: Save a detailed implementation document at the **main repo root** as
   `docs/ai_plans/implement_<feature-name>.md`
   (e.g., `docs/ai_plans/implement_git2tag_merged_support.md`). Include:
   - Implementation Goals
   - Approach / Methodology
   - Detailed Implementation Steps
   - Implementation Details (classes, APIs, files, submodule paths)
   - Architecture Diagrams (if applicable)
```

**`backend-developer.agent.md` — full file:**
```markdown
---
name: "Backend Developer"
description: "Use when: you need to implement C# source code based on a requirement list or AI plan. This agent implements features and verifies them using 'dotnet build'."
tools: [read, edit, search, execute]
---

You are an expert C# Backend Developer working in the **Super H2O IDE** solution.
Your primary responsibility is to implement C# source code strictly based on a
provided requirement list or AI implementation document.

## Approach

1. **Analyze Requirements**: Read the provided implementation document in
   `docs/ai_plans/`. Use `search` and `read` to understand the existing C# codebase
   in the relevant submodule(s): `H2O.IDE/H2O.IDE/`, `H2O.Common/`, `H2O.Git2Sharp/`.
2. **Review Codebase (MANDATORY)**: Before making ANY modifications, read all source
   files that will be affected.
3. **Implement**: Use the `edit` tool to modify or create C# source code inside the
   appropriate submodule. Do NOT add source files to the main repo.
4. **Verify via Compilation — choose minimum scope**:
   - **Step 1 — Assess scope**: Did you only change private/internal code within a single `.csproj`
     (method bodies, private fields, internal classes)? → **Local build**.
     Did you change a public/protected API, an interface, an enum, or a `.csproj` dependency? → **Cross-project build**.
   - **Local build** (single project, fastest): `dotnet build <changed-project>.csproj`
     inside the affected submodule (e.g., `dotnet build H2O.Git2Sharp/Git2Sharp/Git2Sharp.csproj`).
   - **Cross-project build** (when public API changes may break dependents):
     `dotnet build H2O.IDE/H2O.IDE/H2OIDE.csproj`
   - Prefer local build first. Escalate to cross-project only when the assessment above requires it.

## Constraints

- DO NOT modify the requirements. Your job is strictly implementation.
- ALWAYS ensure the code compiles successfully before considering your task complete.
- Fix all compiler errors before finishing.
- All source code changes MUST be made inside the relevant submodule — never in the main repo.
```

**`agent-launcher/SKILL.md` — Project-Specific Notes section:**
```markdown
## Project-Specific Notes

- **Build verification**: `dotnet build H2O.IDE/H2O.IDE/H2OIDE.csproj`
  (or scope to specific `.csproj` for isolated changes)
- **AI plan documents**: Save at `docs/ai_plans/implement_<name>.md` at the **main repo root**
  (e.g., `D:\super.h2o.ide\docs\ai_plans\implement_*.md`); never inside a submodule
- **Primary language**: C# (.NET Framework 4.7.2)
- **Monorepo notes**: Super monorepo — all source code lives in level-1 git submodules
  (`H2O.IDE/`, `H2O.Common/`, `H2O.Git2Sharp/`, etc.). Never commit source to the main repo.
```

---

## Key Specificity Points

| Element | Expected in Generated Agent |
|---------|-----------------------------|
| Source paths | `H2O.IDE/H2O.IDE/`, `H2O.Common/`, `H2O.Git2Sharp/` (with role annotations) |
| AI plan location | `docs/ai_plans/` **at the main repo root** — explicitly, not inside submodules |
| Architecture constraint | "Never add source files to the main repo" |
| Build scope decision | Assess scope first; prefer `dotnet build <X.csproj>` before escalating to solution-wide |
| Project identity | "the **Super H2O IDE** solution" |
