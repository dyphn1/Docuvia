---
name: repo-docs
description: >
  Automatically generate or update README.md and AGENT.md based on a repository's
  current file structure and configuration files. Use this skill whenever the user
  asks to "generate docs", "create a README", "write an AGENT.md", "update project
  docs", "document my repo", or mentions wanting documentation that reflects the
  current state of their codebase. Also trigger when the user says things like
  "my README is outdated", "help me set up AGENT.md for Claude Code", or asks to
  update docs for any project type (Node, Python, .NET, Rust, Go, monorepo, etc.).
---

# Repo Docs Skill

Generates or updates `README.md` and `AGENT.md` by inspecting the repo's real
file structure and configuration files — no guessing, no hallucinating project
details.

---

## Core Principles

- **Never invent facts.** Every command, version number, path, or claim must come
  from a readable file. If data is missing, use `{{TODO: <description and how to verify>}}`
  and tell the user how to fill it in.
- **Preserve human-written content.** When updating existing files, keep prose,
  screenshots, badges, and custom sections intact. Only refresh auto-detectable
  sections (commands, structure, versions).
- **Document your sources.** For each generated section, note which file(s) it
  was derived from. This makes the output verifiable and trustworthy.
- **Show diffs before overwriting.** When existing files will change significantly,
  show a summary of what changed (or a diff) and confirm with the user before writing.

---

## Workflow

### Step 1 — Gather repo context

Run the recon script to collect everything needed in one shot:

```bash
python /path/to/skill/scripts/recon.py <repo_root>
```

The script outputs a JSON summary covering:
- Directory tree (depth-limited, ignoring noise)
- Detected project type(s) and language(s)
- Build / test / lint commands extracted from config files
- Existing README.md and AGENT.md content (if present)
- Key entry points and important files

If the user hasn't provided a repo path, ask for it or default to `.` (current
working directory).

> **If no script available**, run the recon steps manually — see
> `references/manual-recon.md`.

**Also read any existing style-reference files** (e.g., `CLAUDE.md`, `CONTRIBUTING.md`,
another README in the repo) to capture the project's tone, terminology, and formatting
conventions before generating output.

---

### Step 2 — Determine what to generate

Check which files already exist:

| Situation | Action |
|---|---|
| Neither exists | Generate both from scratch |
| README exists, AGENT missing | Generate AGENT.md; offer to refresh README |
| AGENT exists, README missing | Generate README.md; offer to refresh AGENT |
| Both exist | Update both, preserving user-written sections |

**Always ask before overwriting** custom sections (badges, screenshots, license
blocks). When updating, use a merge strategy: keep human-written prose, refresh
auto-detectable sections (install steps, commands, file structure).

If a major reorganization is needed, explain why and present a suggested outline
before proceeding.

---

### Step 3 — Generate README.md

Target audience: **human developers** visiting the repo.

Use the template in `references/readme-template.md` as your structural guide.

#### Required sections

| Section | Description |
|---|---|
| **Title & Summary** | Project name + one-line description |
| **Badges / Quick Start** | Language, license, CI; setup + build in 3–5 steps |
| **Table of Contents** | Auto-generated |
| **Overview & Goals** | 2–4 sentences on purpose and context |
| **Architecture & Components** | High-level module list |
| **Project Structure** | Abbreviated tree with one-line dir descriptions |
| **System Requirements** | OS, runtime versions (Node, Python, .NET, etc.) |
| **Installation / Setup** | Exact commands to prepare the environment |
| **Build** | Per-language build commands |
| **Usage** | Primary usage commands or code snippet |
| **Test** | How to run tests (full suite + single file) |
| **Debugging** | Reference `.vscode/launch.json` or equivalent if present |
| **Packaging & Release** | How to produce artifacts (VSIX, wheel, binary, etc.) |
| **Contributing** | Brief note or link to CONTRIBUTING.md |
| **Troubleshooting / FAQ** | Common pitfalls found in the codebase |
| **License** | SPDX ID from LICENSE file or package.json |
| **For AI Agents** | One-line notice pointing agents to `AGENT.md` (see below) |

Skip sections gracefully when the required info is genuinely unavailable; use
`{{TODO: ...}}` with a verification hint rather than omitting silently.

Write in **clear, friendly prose**. Avoid bullet overload — use bullets only for
lists of commands or options. Preserve project-specific terminology exactly as
found in the source files.

#### AI agent notice in README

Always include a short notice near the top of README.md (after the one-line
description, before the Table of Contents) to help AI models that do not
automatically read `AGENT.md`:

```markdown
> **AI agents:** Read [`AGENT.md`](AGENT.md) for architecture, exact commands,
> conventions, and constraints before making changes.
```

This ensures older or less-capable models — which may only read `README.md` —
still get directed to the authoritative machine-readable context.

**Content segregation rule:** Any content primarily useful to an AI agent
(exact commands, architecture details, coding conventions, constraints,
gotchas) belongs in `AGENT.md`, **not** in `README.md`. If such content
currently exists in README.md, move it to AGENT.md and replace it with a
one-line pointer. Human-facing prose (overview, screenshots, contributing
guide, license) stays in README.md.

#### Multi-language projects

When a repo mixes languages (e.g., C# + TypeScript, Python + Rust), include
**separate Quick Start and Build sub-sections** for each toolchain. Label them
clearly (e.g., "Build — TypeScript", "Build — .NET").

---

### Step 4 — Generate AGENT.md

Target audience: **AI coding agents** (Claude Code, Copilot, etc.).

Use the template in `references/agent-template.md` as your structural guide.

#### Migrate AI-specific content from README

Before generating AGENT.md from scratch, scan the existing README.md for any
content that belongs in AGENT.md instead:
- Sections titled "For AI", "Agent notes", "CLAUDE notes", "Copilot context", etc.
- Detailed command tables intended for automation
- Architecture diagrams described in text form
- Constraint or gotcha lists

Move that content into AGENT.md verbatim (preserving intent), then replace it
in README.md with the standard AI agent notice (see Step 3).

Must include:
- **Project overview** — one tight paragraph (what it is, main tech stack)
- **Commands** — exact, copy-pasteable commands for:
  - `install` / `setup`
  - `dev` / `run`
  - `test` (including how to run a single test file)
  - `lint` / `format`
  - `build`
- **Architecture** — key directories and what lives in each (no fluff)
- **Conventions** — coding style, naming patterns, import conventions detected
  from the codebase or config files (eslint, prettier, ruff, etc.)
- **Important constraints** — files/dirs NOT to edit (generated code, lock files,
  vendor dirs), env vars required, secrets handling
- **Common gotchas** — patterns found that could trip up an AI (e.g., monorepo
  setup, custom aliases, non-standard test runner config)

Write in **terse, directive style** — imperative sentences, no filler. This file
is machine-read first.

---

### Step 5 — Write files

Write to `<repo_root>/README.md` and `<repo_root>/AGENT.md`.

If updating existing files, show a diff summary of what changed before writing.
Always confirm with the user before overwriting.

---

### Step 6 — Verify

Run the following checklist before declaring done:

- [ ] Every command in README.md and AGENT.md exists in a config file or is a
      well-known standard tool invocation.
- [ ] Version numbers (Node, Python, .NET, etc.) match what's in config files.
- [ ] No `[Your Name]`, `TODO` (without `{{}}`), or other stale placeholder text.
- [ ] All `{{TODO: ...}}` entries include a clear description of what's missing
      and how to verify it.
- [ ] Media/screenshot links from the original README are preserved exactly.
- [ ] Multi-language repos have separate command sections per toolchain.
- [ ] README.md contains the AI agent notice pointing to `AGENT.md`.
- [ ] No AI-specific content (commands, constraints, gotchas) remains in README.md
      without a corresponding entry in AGENT.md.

Report remaining `{{TODO}}` gaps to the user with actionable next steps.

---

### Step 7 — Produce deliverables

After writing the files, output:

1. **Changelog paragraph** — a short PR/commit body describing what was updated,
   added, or removed compared to the previous version.
2. **Audit log** — list every file that was read during recon, with an ISO 8601
   timestamp of when analysis was performed.

---

## Config file → field mapping

| Config file | Fields extracted |
|---|---|
| `package.json` | name, description, version, scripts, engines, license, dependencies |
| `pyproject.toml` / `setup.py` | name, version, python_requires, scripts/entry_points |
| `Cargo.toml` | name, version, description, edition |
| `go.mod` | module name, go version |
| `*.sln` / `*.csproj` | .NET project name, target framework, entry points |
| `Makefile` | targets used as commands |
| `.nvmrc` / `.node-version` | Node version requirement |
| `.python-version` | Python version requirement |
| `Dockerfile` | base image, exposed ports, run commands |
| `.github/workflows/*.yml` | CI commands, test commands |
| `jest.config.*` | test command, coverage config |
| `vitest.config.*` | test command |
| `ruff.toml` / `.ruff.toml` | lint command |
| `.eslintrc*` / `eslint.config.*` | lint command |
| `prettier.config.*` | format command |
| `turbo.json` | monorepo pipeline commands |
| `nx.json` | monorepo project structure |
| `pnpm-workspace.yaml` | monorepo packages |
| `compile.sh` / `setup.sh` / `build.sh` | custom build/setup commands |
| `.vscode/launch.json` | debug configurations |
| `CLAUDE.md` / `CONTRIBUTING.md` | tone, conventions, project context |

---

## Edge cases

**Monorepos**: Generate a root-level README/AGENT.md that describes the workspace
and lists packages. Note individual packages may have their own docs.

**Multiple languages**: List all detected languages; include separate Quick Start
and command sections per toolchain.

**Private / no description**: Use directory name as project name; leave description
as `{{TODO: add a one-line project description}}`.

**Existing README with screenshots**: Preserve image links exactly — never remove
or rewrite media references.

**Custom scripts** (e.g., `compile.sh`, `setup.sh`): Include their path and a
one-line summary of what they do (inferred from script header or first few lines).
Mark behavior that can't be confirmed with `{{TODO: verify <script> behavior}}`.
