---
id: PLAT-009
title: ast-core Classified as Technology Provider + Type B Implementation-Layer Directionality
status: accepted
date: 2026-08-16
domains: [platform]
supersedes: []
superseded_by: []
---

# ast-core Classified as Technology Provider + Type B Implementation-Layer Directionality

## Context

Issue #30's dependency-validation tooling (PR #55) added declarative layer-boundary
enforcement (ESLint `no-restricted-imports`, scoped per directory): the Orchestration
(`lib/ui-core`) and Presentation (`artifacts/cli/src`) layers may no longer import any
implementation-layer package. The PR's "Type B" follow-up — implementation-layer
cross-imports (`core→ast-core/plugins-ast`, `plugins-ast→ast-core`) — was **blocked on a
classification contradiction**: AGENTS.md's project table labeled `lib/ast-core` as
**Domain Core**, while the architecture docs
(`virtual-contracts-architecture.md` §2/§8, `testing-and-quality-architecture.md`,
`logging-architecture.md`) and AGENTS.md's own mandate 1 ("Cross-importing between
implementation libraries (`lib/schema`, `lib/ast-core`, `lib/git-local`) is strictly
forbidden") all treat it as a **Technology Provider**. The rules to lock could not be
written until that contradiction was resolved, since the legal dependency directions
depend on which layer ast-core belongs to.

Investigation of the actual code (`ast-core` imports only `@workspace/contracts` plus
third-party tree-sitter/js-yaml/smol-toml; its `LanguageConfig`/`LanguageProvider`
types are tree-sitter-shaped; contracts already defines `IAstProcessor`) confirmed the
architecture docs' classification is correct: ast-core is the raw tree-sitter wrapper —
a Technology Provider — not domain logic. Its sibling `lib/plugins-ast` (one
`LanguageConfig` file per supported language) is a per-language **plugin package**
consuming ast-core's host types, with no own business logic.

Two structural constraints shaped the decision:

1. **`ast-worker.ts` is a `worker_threads` file** — `AstWorkerPool` compiles it to a
   standalone worker script and it runs inside a worker without access to
   `docuviaFactory`. Its imports of ast-core (`LanguageProvider`, `LanguageRegistry`,
   `parseImportDescriptors`) and plugins-ast (`loadDefaultRegistry`) are a hard
   constraint: they cannot be replaced by token resolution, only allowlisted.
2. **`LanguageConfig` leaks tree-sitter `Node` types** (its `buildScopeMap` /
   `classifyCall` signatures) — moving it to contracts would leak the exact
   third-party shape §8 rule 1 says Tech Providers must encapsulate. Only the pure
   constant `SUPPORTED_LANGUAGES` / `SupportedLanguage` union could move.

## Decision

Resolve the contradiction in favor of **ast-core = Technology Provider**, and lock Type
B as **directionality rules** rather than an absolute ban on implementation-layer
cross-imports:

1. **AGENTS.md table fixed**: `lib/ast-core` is now Technology Provider, matching the
   three architecture docs and mandate 1.
2. **`SUPPORTED_LANGUAGES` / `SupportedLanguage` moved to `@workspace/contracts`**
   (new `constants/languages.ts`), per Virtual Contracts §8 ("all shared definitions
   must live in contracts"). `lib/ast-core` keeps a re-export shim so its public API is
   unchanged; `lib/core` and `lib/plugins-ast` now import the constant from contracts
   instead of the tree-sitter tech provider. `lib/plugins-ast` gained an explicit
   `@workspace/contracts` dependency (it previously relied on transitive resolution).
3. **`LanguageConfig` stays in ast-core** — it is tree-sitter-shaped, not a shared
   definition.
4. **Type B ESLint rules** (`lib/ast-core/**` and `lib/plugins-ast/**` restricted):
   - `ast-core → @workspace/core` — **forbidden** (Tech Provider importing Domain Core =
     upward inversion)
   - `ast-core → @workspace/plugins-ast` — **forbidden** (host importing its own plugin =
     cycle)
   - `plugins-ast → @workspace/core` — **forbidden** (plugin package importing Domain Core
     = upward inversion)
   - Legal directions left unlocked: `core → ast-core/plugins-ast` (Domain Core consumes
     Tech Providers) and `plugins-ast → ast-core` (plugin → host).
5. **`test/layer-boundary.test.ts` extended**: Type B fixture tests proving each
   forbidden edge is caught and each legal edge passes, plus the repo-scan regression
   guard now also covers `lib/ast-core` and `lib/plugins-ast`.

Rejected alternative: fully moving `AstProcessingService`/`AstWorkerPool` into ast-core
so it self-registers `IAstProcessor` — this would create a dependency cycle
(ast-core → plugins-ast → ast-core) unless plugins-ast is merged in, a much larger
restructure with no incremental payoff; the worker-thread constraint makes
"core imports nothing from ast-core" unachievable regardless.

## Consequences

- **Positive**: The classification contradiction is resolved; dependency directions are
  now enforced mechanically rather than by convention; `lib/core` / `lib/plugins-ast`
  no longer reach into the tree-sitter package for a plain constant; plugins-ast's
  previously-transitive `@workspace/contracts` dependency is declared explicitly.
- **Negative**: Implementation-layer cross-imports still exist (`core→ast-core`,
  `core→plugins-ast`, `plugins-ast→ast-core`) — deliberately, as they are legal
  directions; ast-core does not implement `IAstProcessor` or self-register, so it is a
  Tech Provider by shape and role but not by lifecycle registration (a known, accepted
  deviation worth revisiting if ast-core ever gains a DI-registered entry point).
- **Risks**: `LanguageConfig` remaining in ast-core means core's `language-detection.ts`
  still type-imports ast-core; acceptable, since the direction is legal and the type is
  tree-sitter-shaped by nature.
