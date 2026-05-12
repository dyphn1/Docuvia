---
description: "Domain knowledge for the create-agent-launcher skill: project discovery patterns, specificity criteria, build scope logic, and tech-stack-to-agent mapping rules."
---

# Create-Agent-Launcher Reference Guide

## Why Specificity Matters

Generic agents fail in practice because they lack project context and search inefficiently. When an agent reads "search the codebase" instead of "search `H2O.IDE/H2O.IDE/Features/` and `H2O.Common/CommonUtility/`", it wastes tokens on irrelevant files.

The goal: agents that can operate without re-explaining project structure at every task.

| | Generic (bad) | Specific (good) |
|---|---|---|
| Approach | `Use search and read to understand the codebase.` | `Read \`H2O.IDE/H2O.IDE/\` (main IDE) and \`H2O.Common/\` (shared utilities).` |
| Build | `Run the build command.` | `Run \`./compile.sh\` (full) or \`dotnet build H2O.IDE.csproj\` (local scope).` |
| Plan path | `Save to docs/ai_plans/.` | `Save at the **main repo root** as \`docs/ai_plans/implement_*.md\` (not inside submodules).` |

---

## Project Discovery: Files to Read

Before generating any agent content, read these files **in priority order**:

### 🔴 Tier 1 — Must Read

| File | What to Extract |
|------|-----------------|
| `README.md` | Project name, module list, build instructions, tech stack overview |
| `AGENT.md` | AI-specific conventions, key paths, architectural notes |
| `CLAUDE.md` | Deep architecture context, project structure, development standards |
| `.github/copilot-instructions.md` | Existing agent conventions and project-specific rules |

### 🟡 Tier 2 — Read When Present

| File | What to Extract |
|------|-----------------|
| `package.json` / `pnpm-workspace.yaml` | Workspace package names, exact script names (`build`, `lint`, `test`) |
| `*.sln` / `Directory.Build.props` | C# solution name, shared MSBuild properties |
| `compile.sh` / `Makefile` (first 50 lines) | Exact build commands and available flags |
| `.gitmodules` | Submodule paths and canonical names |

### 🟢 Tier 3 — For Deep Specificity

| File | What to Extract |
|------|-----------------|
| `tsconfig.json` / `tsconfig.node.json` | TypeScript path aliases, module resolution style |
| Top-level directory listing | Module names and project boundaries |

---

## Context Profile to Build

After reading discovery files, assemble this **Context Profile** before writing any agent file:

```
Project Name:       <human-readable name, e.g., "Super H2O IDE", "Gemini CLI">
Primary Language:   <C#, TypeScript, Python, Polyglot (C# + TypeScript)>
Full Build Command: <exact command, e.g., "./compile.sh", "pnpm run build", "dotnet build H2O.IDE.sln">
Local Build Command:<e.g., "dotnet build H2O.Git2Sharp.csproj", "pnpm --filter gemini-cli build">
Key Source Paths:   <comma-separated, e.g., "H2O.IDE/H2O.IDE/, H2O.Common/, H2O.Git2Sharp/">
AI Plan Path:       <where docs/ai_plans/ lives, e.g., "docs/ai_plans/ at main repo root">
Monorepo Type:      <git submodules | pnpm workspaces | npm workspaces | none>
Workspace File:     <H2O.IDE.sln | pnpm-workspace.yaml | none>
Special Constraints:<e.g., "never commit source code to main repo — only to submodules">
```

Use this profile to fill in `template.md` placeholders.

---

## Specificity Checklist

Apply after generating each file:

### `requirement-analyzer.agent.md`
- [ ] Step 1 (Analyze) names **specific module paths** — not just "the codebase"
- [ ] Step 3 (Document) names the **exact save path** for AI plan docs, including note about root vs submodule
- [ ] Examples in the document step use **real project module names**

### `backend-developer.agent.md`
- [ ] Persona opening names the **actual project** (e.g., "working in the H2O.IDE solution")
- [ ] Step 4 (Verify) uses the **exact build command with flags**
- [ ] Build scope decision logic includes **actual paths** for local vs cross-project triggers

### `agent-launcher/SKILL.md`
- [ ] `## Project-Specific Notes` contains **no placeholder text** — all values are real
- [ ] Primary language reflects actual tech stack
- [ ] Monorepo notes describe real workspace structure with specific path examples

---

## Build Scope Decision Patterns

Include this logic in Backend Developer agents when the project supports it:

| Project Type | Local Scope | Cross-Project Scope | Trigger for Cross-Project |
|-------------|-------------|---------------------|---------------------------|
| C# .NET | `dotnet build <Name.csproj>` | `dotnet build <Solution.sln>` | Changes to public APIs, interfaces, or `.csproj` files |
| TypeScript pnpm | `pnpm --filter <pkg-name> build` | `pnpm run build` | Changes to shared `libs/` or public exports |
| TypeScript npm workspaces | `npm run build -w packages/<name>` | `npm run build` | Changes to shared utilities |
| Hybrid shell+C# | `./compile.sh --mcp <Name>` | `./compile.sh` | Cross-server changes |

---

## Persona Customization by Tech Stack

Always open with the actual project name:

| Stack | Agent Persona Opening |
|-------|-----------------------|
| C# / .NET | `You are an expert C# Backend Developer working in the **{{PROJECT_NAME}}** solution.` |
| TypeScript / Node.js | `You are an expert TypeScript/Node.js Developer working in the **{{PROJECT_NAME}}** monorepo.` |
| Polyglot (C# + TS) | `You are an expert Polyglot Developer (C# and TypeScript) working in the **{{PROJECT_NAME}}** hybrid monorepo.` |
| Python | `You are an expert Python Developer working in the **{{PROJECT_NAME}}** project.` |

---

## Additional Agent Trigger Guide

| Project Signal | Recommend Adding |
|---------------|-----------------|
| Shell scripts (`.sh`) present | **Shell Script Expert** — creates/fixes `.sh` automation scripts |
| React / Vite / frontend code | **Frontend Developer** — implements UI/React components |
| Multiple C# + TypeScript layers | **Architecture Reviewer** — broad structural audit |
| Complex API surface | **Backend API Expert** — API design and inter-service contracts |
| Multiple distinct tech stacks | Generate **separate** Backend Developer agents per language |

---

## Common Mistakes to Avoid

| Mistake | Correct Approach |
|---------|-----------------|
| Using `<target_dir>` as a literal string in the generated file | Replace with the actual path (e.g., `.github/agents`) |
| Writing `run the build command` in agent instructions | Write the exact command: `./compile.sh` or `pnpm run build` |
| Skipping discovery when `README.md` is short | Even short READMEs reveal project name and submodule structure |
| Copying the SKILL.md template placeholder comments verbatim | Remove `<!-- CUSTOMIZE THIS SECTION -->` comments in the output |
| Generating a generic Backend Developer for a polyglot project | Create separate or explicitly polyglot agents with both build paths |
