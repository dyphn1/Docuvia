---
name: enforce-guidelines
description: Use when the user asks to review, refactor, or audit existing codebase implementations to ensure they strictly comply with Docuvia's coding guidelines (SRP, POP, MVC, etc.) and to fix any broken imports or links caused by refactoring.
---

# Skill: Enforce Coding Guidelines & Refactor

## 🎯 Purpose
To systematically review, audit, and refactor implementation files to ensure strict compliance with Docuvia's official coding guidelines. This skill guarantees that the codebase evolves healthily and that all file imports, dependencies, and documentation links remain intact after any structural modifications.

## 🧠 Cognitive Loop Execution

### 1. [Think] Audit & Scope Definition
- **Load Guidelines**: You MUST read `docs/guidelines/index.md` first. Based on the target file's type (e.g., TS logic, React component, API route), identify and read the specific guideline (01 to 06) that applies to it.
- **Define Scope**: Identify the specific target file, module, or directory requested by the user. If the user asks to process all indexed files, scope the audit to the entire workspace.
- **Garbage Collection (Stale/Test Files)**: Evaluate if the file is an obsolete AI-generated test, temporary script, or orphaned file that is no longer needed in production or active development. If it serves no purpose, plan to **delete** it rather than refactor it.
- **Analyze**: Evaluate the target against the applicable guidelines:
  1. **Naming**: Are TS files `kebab-case` and React components `PascalCase`? Are they grouped by domain?
  2. **Architecture**: Is business logic properly extracted to `lib/`? Are controllers/views thin?
  3. **SRP & POP**: Are there any "God Objects"? Does the code depend on concrete implementations instead of interfaces?
  4. **Clean Code**: Are there magic strings/numbers? Is defensive programming (Zod, `?.`, `??`) used?
  5. **Testing**: Do the tests follow the 3A pattern?
  6. **SRE**: Are heavy tasks async? Is there adequate error logging?
- **Plan**: Outline the necessary refactoring steps (e.g., "Split `UserService` into `UserReader` and `UserWriter`", "Extract strings to `constants.ts`").

### 2. [Try] Refactor & Restructure
- **Apply Changes**: Execute the refactoring plan using the appropriate edit tools.
- **Decompose**: If a file violates SRP, extract the logic into smaller, domain-focused files.
- **Centralize**: Move scattered magic values to shared `constants/` or `enums`.
- **Fortify**: Add boundary validation and strict null checks.

### 3. [Try] Link & Import Verification (CRITICAL)
- **Import Resolution**: If you renamed, moved, or split files, you **MUST** fix all broken imports across the codebase. 
  - Use `grep_search` to find references to the old file paths or symbol names.
  - Use `vscode_listCodeUsages` to find all usages of a changed class/function.
- **Documentation Links**: Search for `.md` files that might have referenced the old paths and update their relative links.
- **Typecheck**: Execute the typecheck command (e.g., `pnpm run typecheck` or `npx tsc --noEmit`) in the terminal to mathematically prove that no imports, paths, or types are broken.

### 4. [Summarize] Verification
- Confirm that the refactored code passes type checks and aligns with the initial architectural intent.
- **No Hallucination**: Do not claim success if typechecking fails or if there are still unresolved broken links. If errors exist, backtrack and fix them.

### 5. [Record] Handoff
- Output a structured summary to the user detailing:
  - What guideline violations were identified.
  - Which files were moved, split, or modified.
  - Confirmation that typechecks and link verifications passed.
