import tseslint from "typescript-eslint";

/**
 * Implementation-layer packages that upper layers must never import — including `import type`
 * (docs/gitbook/architecture/virtual-contracts-architecture.md §8). The Virtual Contracts rule:
 * all shared definitions live in `@workspace/contracts`; the Orchestration layer resolves
 * implementations by token via `docuviaFactory`; the Presentation layer only calls `docuviaApi`.
 * Enforced declaratively with ESLint's core `no-restricted-imports` rule, scoped per directory
 * (issue #30). The handful of files that legitimately keep importing `@workspace/core` are the
 * documented "narrow exceptions" in `lib/core/src/index.ts` and are allowlisted below.
 */
const IMPLEMENTATION_PACKAGES = [
  "@workspace/core",
  "@workspace/ast-core",
  "@workspace/plugins-ast",
  "@workspace/schema",
  "@workspace/git-local",
  "@workspace/llm-api",
  "@workspace/remote-api",
];

const LAYER_BOUNDARY_MESSAGE =
  "layer boundary violation: shared constants/helpers must live in @workspace/contracts " +
  "(Virtual Contracts §8), and implementations are only reachable by token via docuviaFactory. " +
  "Move the value to @workspace/contracts, or resolve a token, instead of importing this package.";

/** Type B message (issue #30 follow-up): an implementation-layer import in the wrong direction. */
const TYPE_B_DIRECTION_MESSAGE =
  "implementation-layer direction violation (Type B): Technology Providers (lib/schema, " +
  "lib/git-local, lib/ast-core, lib/llm-api, lib/remote-api) and plugin packages (lib/plugins-ast) " +
  "may not import Domain Core (lib/core) or any sibling implementation package — only plugins " +
  "consuming their host (ast-core) and Domain Core consuming Tech Providers are legal directions. " +
  "Shared constants/types belong in @workspace/contracts.";

/**
 * Implementation packages a Technology Provider may never import (Type B, issue #30 follow-up):
 * Domain Core (upward inversion) or any sibling implementation package (cross-import, AGENTS.md
 * mandate 1). Only `@workspace/contracts` — plus, for plugin packages alone, their host
 * `@workspace/ast-core` — is legal. Self-imports are included deliberately: a Tech Provider
 * importing itself via its package name is also a smell worth failing on.
 */
const TECH_PROVIDER_FORBIDDEN = [
  "@workspace/core",
  "@workspace/ast-core",
  "@workspace/plugins-ast",
  "@workspace/schema",
  "@workspace/git-local",
  "@workspace/llm-api",
  "@workspace/remote-api",
];

/** Plugin packages' forbidden list — identical to the Tech Providers' except their host
 * `@workspace/ast-core` stays legal (plugin → host, PLAT-009). */
const PLUGIN_PACKAGE_FORBIDDEN = TECH_PROVIDER_FORBIDDEN.filter(
  (p) => p !== "@workspace/ast-core",
);

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      ".claude/worktrees/**",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      complexity: ["error", 10],
    },
  },
  // Orchestration layer (lib/ui-core): contracts-only, per Virtual Contracts §8 rule 2.
  {
    files: ["lib/ui-core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: IMPLEMENTATION_PACKAGES, message: LAYER_BOUNDARY_MESSAGE },
          ],
        },
      ],
    },
  },
  // Documented narrow exceptions (lib/core/src/index.ts): pure, side-effect-free domain helpers
  // that are not DI-registered behind a token and cannot move to contracts (they're coupled to
  // the language registry or to git/store IO). Keep this list as small as possible.
  //
  // isDiscoverableSourceFile moved to @workspace/contracts (issue #243), so
  // run-delta-ingestion.ts no longer needs this exception -- removed to restore the layer-
  // boundary lint here.
  {
    files: [
      // renderL3Card / computeL2GitPathsByNodeId (L3 renderers)
      "lib/ui-core/src/workflows/snapshot/pack-current-graph.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  // Type B (issue #30 follow-up): implementation-layer directionality, per Virtual Contracts §8
  // rule 1 + AGENTS.md mandate 1 + PLAT-009. ast-core is a Technology Provider (raw tree-sitter
  // wrapper); plugins-ast is its per-language plugin package; schema/git-local/llm-api/remote-api
  // are the remaining Technology Providers. Legal directions are left unlocked: core →
  // ast-core/plugins-ast (Domain Core consumes Tech Providers) and plugins-ast → ast-core
  // (plugin → host). Locked directions below are the ones that would invert or cycle the
  // dependency graph — no Technology Provider may import lib/core (upward inversion), any
  // Technology Provider may not import a sibling implementation package (cross-import), and
  // ast-core may not import its own plugin package (host → plugin = cycle).
  {
    files: [
      "lib/ast-core/**/*.ts",
      "lib/schema/**/*.ts",
      "lib/git-local/**/*.ts",
      "lib/llm-api/**/*.ts",
      "lib/remote-api/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: TECH_PROVIDER_FORBIDDEN,
              message: TYPE_B_DIRECTION_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/plugins-ast/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: PLUGIN_PACKAGE_FORBIDDEN,
              message: TYPE_B_DIRECTION_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  // Presentation layer (artifacts/cli/src): contracts + ui-core only, per Virtual Contracts §8
  // rules 1-2. (cli integration tests are excluded from this rule on purpose: they reach into
  // tech providers for fixture setup against real temp resources.)
  {
    files: ["artifacts/cli/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: IMPLEMENTATION_PACKAGES, message: LAYER_BOUNDARY_MESSAGE },
          ],
        },
      ],
    },
  },
  // Composition root (application-lifecycle-and-state.md Bootstrap phase): the Presentation
  // layer is the only layer allowed to import implementation libraries, purely for their
  // docuviaFactory self-registration side effect.
  {
    files: ["artifacts/cli/src/registration.ts"],
    rules: { "no-restricted-imports": "off" },
  },
);
