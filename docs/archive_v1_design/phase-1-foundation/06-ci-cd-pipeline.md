# CI/CD Pipeline

## Overview
Automate lint, test, and build checks on every push and pull request via GitHub Actions.

## Implementation
`.github/workflows/ci.yml` — parallel `lint` job (pnpm prettier --check) and `typecheck-and-build` job (typecheck all + build all), pnpm 9, Node 22, `concurrency.cancel-in-progress: true` to abort stale runs.

### Key Files
- `.github/workflows/ci.yml`
- `.prettierrc`
- `.prettierignore`

## Status
**✅ Done**

> ⚠️ **Doc was stale** — previously recorded as "Not started" but the CI/CD pipeline is fully implemented.

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate `.github/workflows/ci.yml` exists** and is a valid GitHub Actions workflow file (YAML, non-empty `jobs` block).
- [ ] **Verify `.prettierrc` and `.prettierignore` exist** in the repo root.

### Job: `lint`

- [ ] **Confirm `lint` job uses `pnpm prettier --check .`** (or equivalent) to fail fast on unformatted code.
- [ ] **Confirm `pnpm 9` is specified** in `uses: pnpm/action-setup@v4` with `version: 9`.
- [ ] **Confirm Node.js 22** is used via `actions/setup-node@v4` with `node-version: 22`.

### Job: `typecheck-and-build`

- [ ] **Confirm `typecheck-and-build` job runs `pnpm run typecheck` and `pnpm run build`** (in sequence or combined) and reports failure if either step exits non-zero.
- [ ] **Confirm the two jobs run in parallel** (no `needs:` dependency between them).
- [ ] **Confirm `concurrency.cancel-in-progress: true`** is set to cancel stale CI runs when a new push arrives.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` locally to ensure strict TypeScript compliance matches the CI job.
- [ ] **Build Process**: Execute `pnpm run build` locally to ensure the artifacts compile successfully.

---

## 🤖 Agent Sub-Tasks

### Automated CI Workflow Inspection

- [ ] **Trigger `Explore`** to read `.github/workflows/ci.yml` in full.
  - **Validation Goal**: Confirm the YAML contains exactly two parallel jobs (`lint` and `typecheck-and-build`), that each uses Node 22 + pnpm 9, and that `concurrency.cancel-in-progress: true` is present.

### Formatting Baseline Check

- [ ] **Trigger `Task Verifier`** to run:
  ```bash
  pnpm prettier --check .
  ```
  - **Validation Goal**: Exit code 0 — no unformatted files. Any failure means the CI `lint` job would also fail.

### Build Integrity Verification

- [ ] **Trigger `Task Verifier`** to run:
  ```bash
  pnpm run typecheck && pnpm run build
  ```
  - **Validation Goal**: Both commands exit with code 0, proving the CI `typecheck-and-build` job would pass on the current HEAD.

### Frontend Validation

- [ ] **Trigger `Frontend Developer`**:
  - Inspect the `.tsx` files for correct component hierarchy, prop types, and state management.
  - **Validation Goal**: Guarantee that there are no unused variables, exhaustive dependencies are met in `useEffect`, and the UI aligns with the wireframe/design spec.


### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
