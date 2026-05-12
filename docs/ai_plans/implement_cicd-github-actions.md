# Implementation Plan: CI/CD GitHub Actions Pipeline

**Date**: 2026-05-12  
**Priority**: 🔴 High — Core Gap (Phase 1)  
**Analyst**: Requirement Analyzer Agent

---

## 1. Implementation Goals

Add a GitHub Actions CI/CD pipeline to the Docuvia monorepo that automatically runs on every push and pull request. The pipeline must:

1. **Verify code quality** via Prettier format checking
2. **Verify type correctness** via TypeScript across all workspace packages
3. **Verify build integrity** by compiling all packages (api-server via esbuild, kg-engine via Vite)
4. **Require zero secrets** — all steps are static analysis or compilation only

---

## 2. Context: Current State

### Build Infrastructure (Already Exists)

| Package                | Build Tool            | Script                                        |
| ---------------------- | --------------------- | --------------------------------------------- |
| Root workspace         | —                     | `pnpm run typecheck` → tsc project references |
| `artifacts/api-server` | esbuild (`build.mjs`) | `pnpm run build`                              |
| `artifacts/kg-engine`  | Vite                  | `pnpm run build`                              |
| `lib/db`               | No compile step       | Only `push` (Drizzle)                         |
| `lib/api-zod`          | TypeScript            | `typecheck` only                              |
| `lib/api-client-react` | TypeScript            | `typecheck` only                              |

### Root `package.json` Scripts (Pre-CI)

```json
"build": "pnpm run typecheck && pnpm -r --if-present run build",
"typecheck:libs": "tsc --build",
"typecheck": "pnpm run typecheck:libs && pnpm -r --filter \"./artifacts/**\" --filter \"./scripts\" --if-present run typecheck"
```

### Key Findings

- **pnpm lockfile version**: `9.0` → requires pnpm 9.x
- **Node.js target**: `@types/node: ^25.3.3` in the catalog — the type definitions target Node 25 API surface; Node 22 LTS is sufficient for build/typecheck (no runtime execution)
- **Prettier**: installed as a root devDependency, but **no `.prettierrc` config file** and **no `lint` script** exist
- **No test framework**: vitest/jest not installed anywhere; CI cannot run unit tests
- **No secrets required**: TypeScript compilation and esbuild/Vite bundling do not connect to PostgreSQL (`DATABASE_URL` is only validated at runtime, not during `tsc --noEmit` or bundling)
- **`preinstall` guard**: root `package.json` rejects non-pnpm package managers — GitHub Actions must use `pnpm/action-setup`
- **Auto-generated files**: `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/` are Orval-generated and should be excluded from Prettier checks

---

## 3. Approach / Methodology

### Why CI/CD First (Over Agentic RAG)

1. **Zero blockers** — all required tooling is already present in the repo
2. **Self-contained** — only needs new YAML + config files, zero application code changes
3. **Foundational** — protects every future feature (Agentic RAG, etc.) from silent regressions
4. **Fast delivery** — single developer session; no architecture decisions required
5. **Agentic RAG** is architecturally complex (NLP intent classification, hybrid vector+graph routing, response aggregation) and deserves its own dedicated planning cycle

### Two-Job Strategy

Split into two parallel jobs for maximum feedback speed:

- **`lint`** — Prettier format check (fast, ~30s) — fails fast before spending time on compilation
- **`typecheck-and-build`** — TypeScript checking + compilation (slower, ~2–3 min)

This allows developers to see formatting errors immediately without waiting for the full build.

### Prettier Configuration Strategy

Since no `.prettierrc` exists, infer the style from the existing codebase:

- Double quotes (observed in all `.ts`/`.tsx` files)
- 2-space indentation (consistent throughout)
- Semicolons present
- Trailing commas: `"es5"` (matches TypeScript idiomatic style)
- Print width: `100` (TypeScript monorepo standard)

**Important**: Before merging the CI workflow, run `prettier --write .` once on the repo to normalize any pre-existing formatting inconsistencies. Otherwise the `lint` job may fail on unchanged files.

---

## 4. Detailed Implementation Steps

### Step 1: Create `.prettierrc` (Root)

Create `d:\GitHub\miya.daniel\Docuvia\.prettierrc` with content that matches the observed code style:

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "printWidth": 100,
  "trailingComma": "es5"
}
```

### Step 2: Create `.prettierignore` (Root)

Create `d:\GitHub\miya.daniel\Docuvia\.prettierignore` to exclude generated, compiled, and lock files:

```
# Dependencies
node_modules/

# Build outputs
**/dist/
**/build/

# Orval-generated code (auto-generated, do not lint)
lib/api-zod/src/generated/
lib/api-client-react/src/generated/

# Lock files
pnpm-lock.yaml

# Attached assets
attached_assets/
```

### Step 3: Add `lint` Script to Root `package.json`

Add two scripts to the root `package.json`:

- `"lint": "prettier --check ."` — used by CI
- `"format": "prettier --write ."` — used by developers locally to fix formatting

**Before modification** (root `package.json` scripts section):

```json
"scripts": {
  "preinstall": "sh -c 'rm -f package-lock.json yarn.lock; case \"$npm_config_user_agent\" in pnpm/*) ;; *) echo \"Use pnpm instead\" >&2; exit 1 ;; esac'",
  "build": "pnpm run typecheck && pnpm -r --if-present run build",
  "typecheck:libs": "tsc --build",
  "typecheck": "pnpm run typecheck:libs && pnpm -r --filter \"./artifacts/**\" --filter \"./scripts\" --if-present run typecheck"
}
```

**After modification**:

```json
"scripts": {
  "preinstall": "sh -c 'rm -f package-lock.json yarn.lock; case \"$npm_config_user_agent\" in pnpm/*) ;; *) echo \"Use pnpm instead\" >&2; exit 1 ;; esac'",
  "build": "pnpm run typecheck && pnpm -r --if-present run build",
  "typecheck:libs": "tsc --build",
  "typecheck": "pnpm run typecheck:libs && pnpm -r --filter \"./artifacts/**\" --filter \"./scripts\" --if-present run typecheck",
  "lint": "prettier --check .",
  "format": "prettier --write ."
}
```

### Step 4: Create `.github/workflows/ci.yml`

Create `d:\GitHub\miya.daniel\Docuvia\.github\workflows\ci.yml`:

```yaml
name: CI

on:
  push:
    branches:
      - main
      - dev
  pull_request:
    branches:
      - main
      - dev

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ──────────────────────────────────────────────────────────
  # Job 1: Format check (fast feedback — runs in parallel with typecheck-and-build)
  # ──────────────────────────────────────────────────────────
  lint:
    name: Lint & Format
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Check formatting
        run: pnpm run lint

  # ──────────────────────────────────────────────────────────
  # Job 2: TypeScript type-check + compile all packages
  # ──────────────────────────────────────────────────────────
  typecheck-and-build:
    name: Typecheck & Build
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type check (all packages)
        run: pnpm run typecheck

      - name: Build all packages
        run: pnpm -r --if-present run build
        env:
          # Vite needs NODE_ENV for production builds
          NODE_ENV: production
```

> **Note**: `build` is intentionally separated from `typecheck` in Job 2 so that TypeScript errors are reported distinctly from build tool errors. The root `build` script already runs typecheck, but we call `typecheck` explicitly first so GitHub shows a clear, labelled step for type errors.

> **`concurrency` block**: Cancels in-progress CI runs for the same branch when a new push arrives. Prevents redundant builds on rapid pushes.

---

## 5. Files to Create / Modify

| Action     | File Path                  | Purpose                          |
| ---------- | -------------------------- | -------------------------------- |
| **Create** | `.github/workflows/ci.yml` | GitHub Actions CI workflow       |
| **Create** | `.prettierrc`              | Prettier formatting config       |
| **Create** | `.prettierignore`          | Exclude generated/compiled files |
| **Modify** | `package.json` (root)      | Add `lint` and `format` scripts  |

---

## 6. Affected pnpm Workspace Packages

| Package                             | Impact      | How                                          |
| ----------------------------------- | ----------- | -------------------------------------------- |
| Root workspace                      | ✅ Direct   | New scripts, new config files                |
| `artifacts/api-server`              | ✅ Indirect | Typecheck + build run in CI                  |
| `artifacts/kg-engine`               | ✅ Indirect | Typecheck + build run in CI                  |
| `lib/db`                            | ✅ Indirect | Included in typecheck via project references |
| `lib/api-zod`                       | ✅ Indirect | Included in typecheck                        |
| `lib/api-client-react`              | ✅ Indirect | Included in typecheck                        |
| `lib/integrations-openai-ai-server` | ✅ Indirect | Included in typecheck                        |
| `scripts`                           | ✅ Indirect | Included in `--filter ./scripts` typecheck   |

---

## 7. Pre-Merge Prerequisite (Critical)

Before merging the CI workflow PR, run the following locally to normalize all files:

```bash
pnpm run format
git add -A
git commit -m "style: normalize formatting with prettier"
```

If this is skipped, the `lint` job in CI will almost certainly fail on pre-existing files that were never run through Prettier.

---

## 8. Architecture Diagram

```
GitHub Push / PR
       │
       ▼
┌──────────────────────────────────────────────┐
│             ci.yml (GitHub Actions)          │
│                                              │
│  ┌──────────────┐    ┌────────────────────┐  │
│  │     lint     │    │ typecheck-and-build│  │
│  │  (parallel)  │    │    (parallel)      │  │
│  │              │    │                    │  │
│  │ pnpm install │    │  pnpm install      │  │
│  │ pnpm lint    │    │  pnpm typecheck    │  │
│  │ (prettier    │    │  pnpm -r build     │  │
│  │  --check)    │    │  (esbuild + vite)  │  │
│  └──────────────┘    └────────────────────┘  │
│                                              │
│  Both must PASS before merge is allowed      │
└──────────────────────────────────────────────┘
```

---

## 9. Future Enhancements (Out of Scope for This Task)

After the base CI is merged, consider these additions in subsequent PRs:

1. **Test step**: Once vitest is added to any package, add `pnpm -r --if-present run test` as a third job
2. **PostgreSQL service container**: For integration tests that need a real database, add a `services.postgres` block to the CI job
3. **Deploy job**: After passing CI, deploy to staging with `needs: [lint, typecheck-and-build]`
4. **Dependabot**: Add `.github/dependabot.yml` to auto-update GitHub Actions versions

---

## 10. Risk Assessment

| Risk                                  | Likelihood | Mitigation                                           |
| ------------------------------------- | ---------- | ---------------------------------------------------- |
| Prettier fails on all existing files  | **High**   | Run `pnpm run format` before merging CI PR           |
| TypeScript errors in existing code    | **Low**    | `pnpm run typecheck` already works locally           |
| pnpm version mismatch in CI           | **Low**    | Pinned to `version: 9` in `pnpm/action-setup`        |
| Build fails due to missing env vars   | **None**   | TypeScript check + esbuild/Vite do not connect to DB |
| `preinstall` script rejects CI runner | **None**   | `pnpm/action-setup` sets pnpm user agent correctly   |
