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
  {
    files: [
      // isSupportedSourceFile (language registry)
      "lib/ui-core/src/workflows/analyze/decision-extraction.ts",
      // isDiscoverableSourceFile (language registry)
      "lib/ui-core/src/workflows/analyze/run-delta-ingestion.ts",
      // renderL3Card / computeL2GitPathsByNodeId (L3 renderers)
      "lib/ui-core/src/workflows/snapshot/pack-current-graph.ts",
      // importL3CardsFromKnowledgeBranch (git -> store IO)
      "lib/ui-core/src/workflows/sync-knowledge/sync-knowledge-workflow.ts",
    ],
    rules: { "no-restricted-imports": "off" },
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
