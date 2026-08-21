/**
 * Layer-boundary enforcement tests (issue #30 — dependency validation tooling).
 *
 * The Virtual Contracts architecture (docs/gitbook/architecture/virtual-contracts-architecture.md
 * §8) forbids the Orchestration (`lib/ui-core`) and Presentation (`artifacts/cli`) layers from
 * importing implementation layers (`lib/core`, `lib/ast-core`, `lib/plugins-ast`, `lib/schema`,
 * `lib/git-local`, ...) directly — including `import type`. The actual
 * enforcement lives in `eslint.config.mjs` (declarative `no-restricted-imports`, scoped per
 * directory). This suite:
 *
 *  1. proves the real config catches each forbidden edge and lets each allowed edge through
 *     (fixture tests), and
 *  2. scans the actual repo source to guard against drift — any future forbidden import turns
 *     this test red (regression protection, issue #30 Stage 3).
 *
 * The handful of files that legitimately keep importing `@workspace/core` are the documented
 * "narrow exceptions" listed in `lib/core/src/index.ts` (pure, side-effect-free domain helpers
 * that are not DI-registered behind a token) — they're allowlisted in `eslint.config.mjs` and
 * intentionally NOT flagged here.
 */
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import config from "../eslint.config.mjs";

/** Every implementation-layer package that upper layers must not import. */
const FORBIDDEN_PACKAGES = [
  "@workspace/core",
  "@workspace/ast-core",
  "@workspace/plugins-ast",
  "@workspace/schema",
  "@workspace/git-local",
  "@workspace/llm-api",
  "@workspace/remote-api",
];

const ALLOWED_PACKAGES = ["@workspace/contracts", "@workspace/ui-core"];

function makeEslint(): ESLint {
  return new ESLint({ overrideConfigFile: true, overrideConfig: config });
}

/** Lints a virtual file and returns only layer-boundary violations. */
async function layerViolations(
  code: string,
  filePath: string,
): Promise<Array<{ line: number; message: string }>> {
  const eslint = makeEslint();
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter((m) => m.ruleId === "no-restricted-imports")
    .map((m) => ({ line: m.line ?? 0, message: m.message }));
}

const IMPORT_SAMPLES = [
  ...FORBIDDEN_PACKAGES.map((p) => `import { x } from "${p}";`),
  ...ALLOWED_PACKAGES.map((p) => `import { x } from "${p}";`),
  `import type { x } from "@workspace/core";`,
  `import "@workspace/core";`,
  `export { x } from "@workspace/core";`,
  `import { x } from "@workspace/core/sub";`,
].join("\n");

describe("layer-boundary eslint config", () => {
  it("forbids every implementation-layer package from lib/ui-core (Orchestration)", async () => {
    const violations = await layerViolations(
      IMPORT_SAMPLES,
      "lib/ui-core/src/workflows/analyze/sample.ts",
    );
    const flagged = violations.map((v) => v.line);
    // 7 forbidden + type + side-effect + re-export + subpath = 11 restricted lines; allowed lines are 1-2.
    expect(flagged).toHaveLength(11);
    expect(violations[0]?.message).toMatch(/lib\/core|@workspace\/core/);
  });

  it("forbids implementation-layer packages from artifacts/cli/src (Presentation)", async () => {
    const violations = await layerViolations(
      IMPORT_SAMPLES,
      "artifacts/cli/src/commands/sample.ts",
    );
    expect(violations).toHaveLength(11);
  });

  it("allows artifacts/cli/src to import @workspace/ui-core and @workspace/contracts", async () => {
    const violations = await layerViolations(
      `import { docuviaApi } from "@workspace/ui-core";\nimport { TOKENS } from "@workspace/contracts";`,
      "artifacts/cli/src/commands/sample.ts",
    );
    expect(violations).toHaveLength(0);
  });

  it("allows allowlisted ui-core files to keep importing @workspace/core (documented narrow exceptions)", async () => {
    const allowlisted = [
      "lib/ui-core/src/workflows/analyze/run-delta-ingestion.ts",
      "lib/ui-core/src/workflows/snapshot/pack-current-graph.ts",
    ];
    for (const filePath of allowlisted) {
      const violations = await layerViolations(
        `import { someHelper } from "@workspace/core";`,
        filePath,
      );
      expect(violations, filePath).toHaveLength(0);
    }
  });

  it("allows artifacts/cli/src/registration.ts (composition root) to import implementation packages", async () => {
    const violations = await layerViolations(
      `import "@workspace/schema";\nimport "@workspace/core";`,
      "artifacts/cli/src/registration.ts",
    );
    expect(violations).toHaveLength(0);
  });

  // --- Type B (issue #30 follow-up): implementation-layer directionality ----------------------

  it("forbids ast-core (Tech Provider) from importing lib/core (upward inversion)", async () => {
    const violations = await layerViolations(
      `import { someDomainHelper } from "@workspace/core";`,
      "lib/ast-core/src/parser-core.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(
      /implementation-layer direction violation/,
    );
  });

  it("forbids ast-core (Tech Provider) from importing its own plugin package plugins-ast (cycle)", async () => {
    const violations = await layerViolations(
      `import { loadDefaultRegistry } from "@workspace/plugins-ast";`,
      "lib/ast-core/src/language-registry.ts",
    );
    expect(violations).toHaveLength(1);
  });

  it("forbids plugins-ast (plugin package) from importing lib/core (upward inversion)", async () => {
    const violations = await layerViolations(
      `import { someDomainHelper } from "@workspace/core";`,
      "lib/plugins-ast/src/index.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(
      /implementation-layer direction violation/,
    );
  });

  it("allows plugins-ast → ast-core (plugin → host) and core → ast-core/plugins-ast (Domain → Tech)", async () => {
    // plugin → host
    const pluginHost = await layerViolations(
      `import type { LanguageConfig } from "@workspace/ast-core";\nimport { LanguageRegistry } from "@workspace/ast-core";`,
      "lib/plugins-ast/src/languages/typescript.ts",
    );
    expect(pluginHost).toHaveLength(0);
    // Domain → Tech (unlocked direction; core lives outside the Type B-restricted dirs)
    const domainTech = await layerViolations(
      `import { SemanticDiffDetector } from "@workspace/ast-core";\nimport { DEFAULT_REGISTRY } from "@workspace/plugins-ast";`,
      "lib/core/src/detector/semantic-diff-analyzer.service.ts",
    );
    expect(domainTech).toHaveLength(0);
  });

  it("forbids every remaining Tech Provider from importing lib/core (upward inversion)", async () => {
    const techProviders = [
      "lib/schema/src/sqlite/graph-store.ts",
      "lib/git-local/src/git-local-provider.ts",
      "lib/llm-api/src/fetch-llm-client.ts",
      "lib/remote-api/src/fetch-remote-sync-client.ts",
    ];
    for (const filePath of techProviders) {
      const violations = await layerViolations(
        `import { someDomainHelper } from "@workspace/core";`,
        filePath,
      );
      expect(violations, filePath).toHaveLength(1);
      expect(violations[0]?.message).toMatch(
        /implementation-layer direction violation/,
      );
    }
  });

  it("forbids Tech Providers from cross-importing each other (AGENTS.md mandate 1)", async () => {
    const schema = await layerViolations(
      `import { GitLocalProvider } from "@workspace/git-local";`,
      "lib/schema/src/sqlite/graph-store.ts",
    );
    expect(schema).toHaveLength(1);
    const gitLocal = await layerViolations(
      `import { GraphStore } from "@workspace/schema";`,
      "lib/git-local/src/git-local-provider.ts",
    );
    expect(gitLocal).toHaveLength(1);
  });

  it("forbids ast-core and plugins-ast from importing sibling Tech Providers", async () => {
    const astCore = await layerViolations(
      `import { GraphStore } from "@workspace/schema";`,
      "lib/ast-core/src/parser-core.ts",
    );
    expect(astCore).toHaveLength(1);
    // plugins-ast may only reach up to its host ast-core, not any other Tech Provider
    const plugin = await layerViolations(
      `import { GraphStore } from "@workspace/schema";`,
      "lib/plugins-ast/src/index.ts",
    );
    expect(plugin).toHaveLength(1);
  });

  it("allows every Tech Provider to import @workspace/contracts", async () => {
    const files = [
      "lib/schema/src/sqlite/graph-store.ts",
      "lib/git-local/src/git-local-provider.ts",
      "lib/llm-api/src/fetch-llm-client.ts",
      "lib/remote-api/src/fetch-remote-sync-client.ts",
      "lib/ast-core/src/parser-core.ts",
      "lib/plugins-ast/src/index.ts",
    ];
    for (const filePath of files) {
      const violations = await layerViolations(
        `import { TOKENS } from "@workspace/contracts";`,
        filePath,
      );
      expect(violations, filePath).toHaveLength(0);
    }
  });

  // Linting 9 source globs through the real eslint config exceeds vitest's 5s default
  // under CI CPU contention (cold cache, parallel workers) — generous budget here.
  it("has zero layer-boundary violations across the actual repo source (regression guard)", async () => {
    const eslint = makeEslint();
    const results = await eslint.lintFiles([
      "lib/ui-core/**/*.ts",
      "artifacts/cli/src/**/*.ts",
      "lib/core/**/*.ts",
      "lib/ast-core/**/*.ts",
      "lib/plugins-ast/**/*.ts",
      "lib/schema/**/*.ts",
      "lib/git-local/**/*.ts",
      "lib/llm-api/**/*.ts",
      "lib/remote-api/**/*.ts",
    ]);
    const violations = results.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId === "no-restricted-imports")
        .map((m) => `${r.filePath}:${m.line}`),
    );
    expect(violations).toEqual([]);
  }, 60_000);
});
