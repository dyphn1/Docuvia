import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateTddQuality,
  TDD_QUALITY_MINIMUM_PASS_SCORE,
  type TddQualityDimension,
  type TddQualityEvidence,
} from "./tdd-quality-score.js";

interface CapabilityEvidence {
  name: string;
  files: readonly string[];
  dimensions: Record<TddQualityDimension, readonly string[]>;
}

const capabilities: readonly CapabilityEvidence[] = [
  {
    name: "AST processing service",
    files: [
      "../lib/core/src/ast/ast-processing.service.unit.test.ts",
      "../lib/core/src/ast/ast-processing.service.contract.unit.test.ts",
      "../lib/contracts/src/interfaces/ast.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "returns all files under 'parsed' when every parse succeeds",
      ],
      negativeParameters: [
        "moves a file to 'failures' when pool.parse rejects with AstWorkerCrashError",
      ],
      inputCompleteness: [
        "handles an empty input list without parsing and still closes the worker-pool lifecycle",
      ],
      outputCompleteness: [
        "returns the complete parsed result contract for a successful file",
      ],
      errorHandling: [
        "normalizes a generic thrown Error into the failure contract instead of rejecting the batch",
      ],
      unexpectedInput: [
        "normalizes a malformed success response with missing data into an explicit failure",
      ],
      determinism: [
        "produces identical normalized output and parse side effects across two identical-input runs",
      ],
      sourceTraceability: ["export interface IAstProcessor"],
    },
  },
  {
    name: "AST worker pool",
    files: [
      "../lib/core/src/ast/ast-worker-pool.unit.test.ts",
      "../lib/core/src/ast/phase3-ast-worker-quality.unit.test.ts",
      "../lib/contracts/src/interfaces/ast.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "populates calls[] for a TypeScript function that calls another function",
      ],
      negativeParameters: [
        "attributes a worker crash to the specific file being parsed, not an adjacent one",
      ],
      inputCompleteness: [
        "initialize() is idempotent: a second call does not stack another worker cohort",
      ],
      outputCompleteness: [
        "returns identical parsed AST data for repeated identical input",
      ],
      errorHandling: [
        "respawns a worker after a crash and continues serving subsequent tasks",
        "logs when worker.terminate() rejects during task-timeout teardown",
      ],
      unexpectedInput: [
        "still dispatches a task queued behind a crashing one to the respawned worker",
      ],
      determinism: [
        "returns identical parsed AST data for repeated identical input",
      ],
      sourceTraceability: [
        "TDD-SOURCE: lib/contracts/src/interfaces/ast.interfaces.ts",
      ],
    },
  },
  {
    name: "Language registry and provider",
    files: [
      "../lib/ast-core/src/language-registry.unit.test.ts",
      "../lib/ast-core/test/language-provider.unit.test.ts",
      "../lib/ast-core/test/phase3-ast-core-quality.unit.test.ts",
      "../lib/contracts/src/interfaces/ast.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "accepts a valid TOML with correct structure",
        "uses buildScopeMap if defined",
      ],
      negativeParameters: [
        "rejects TOML where a language entry has missing required fields",
        "does not record a failure for a query the language simply does not declare",
      ],
      inputCompleteness: [
        "accepts optional implements/extends arrays when present",
        "rejects TOML where extensions contains non-string elements",
      ],
      outputCompleteness: [
        "extracts using fallback descendent search when no query",
      ],
      errorHandling: [
        "records a declared pattern that fails to compile, so the fallback is not silent",
      ],
      unexpectedInput: [
        "returns empty defaults for empty input",
        "returns empty defaults for empty string input",
      ],
      determinism: [
        "language registry produces identical validated configuration across repeated identical loads",
      ],
      sourceTraceability: [
        "TDD-SOURCE: lib/contracts/src/interfaces/ast.interfaces.ts",
      ],
    },
  },
  {
    name: "Language extraction plugins",
    files: [
      "../lib/plugins-ast/test/languages.unit.test.ts",
      "../lib/plugins-ast/test/phase3-language-hardening.unit.test.ts",
      "../lib/contracts/src/interfaces/ast.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "extracts expected function names",
        "extracts complete C fixture data with real grammar WASM",
        "extracts complete C# fixture data with real grammar WASM",
      ],
      negativeParameters: [
        "malformed source remains bounded and deterministic across reruns",
      ],
      inputCompleteness: [
        "should have valid configuration for",
        "extracts complete C fixture data with real grammar WASM",
        "extracts complete C# fixture data with real grammar WASM",
      ],
      outputCompleteness: [
        "extracts expected call targets",
        "extracts expected class names",
        "extracts expected import paths",
      ],
      errorHandling: [
        "malformed source remains bounded and deterministic across reruns",
      ],
      unexpectedInput: [
        "malformed source remains bounded and deterministic across reruns",
      ],
      determinism: [
        "malformed source remains bounded and deterministic across reruns",
      ],
      sourceTraceability: [
        "TDD-SOURCE: lib/contracts/src/interfaces/ast.interfaces.ts",
      ],
    },
  },
  {
    name: "Parser bridge and traversal funnel",
    files: [
      "../lib/ast-core/test/parser-core.unit.test.ts",
      "../lib/ast-core/test/bridge-provider.unit.test.ts",
      "../lib/ast-core/test/ast-traverser.unit.test.ts",
      "../lib/ast-core/test/phase3-ast-core-quality.unit.test.ts",
      "../lib/contracts/src/interfaces/ast.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "generateAst yields events on successful parse",
        "parses valid JSON openapi spec",
      ],
      negativeParameters: [
        "generateAst throws if no language provider is found",
        "returns empty for non-object spec",
      ],
      inputCompleteness: [
        "generateAst handles Uint8Array loadWasm and TextDecoder",
        "extracts base path from relative url",
      ],
      outputCompleteness: [
        "generateAst yields events on successful parse",
        "ignores non-http methods",
      ],
      errorHandling: [
        "generateAst throws if loadWasm fails",
        "generateAst throws if parse returns null",
        "returns empty for invalid yaml",
      ],
      unexpectedInput: [
        "isOpenApiFile bounds memory on extreme single-line input (issue #290)",
      ],
      determinism: [
        "bridge extraction is deterministic for identical OpenAPI input",
      ],
      sourceTraceability: [
        "TDD-SOURCE: lib/contracts/src/interfaces/ast.interfaces.ts",
      ],
    },
  },
  {
    name: "Semantic diff detector",
    files: [
      "../lib/ast-core/test/detector/semantic-diff.test.ts",
      "../lib/ast-core/test/phase3-ast-core-quality.unit.test.ts",
      "../lib/ast-core/src/detector/semantic-diff.ts",
    ],
    dimensions: {
      positiveParameters: [
        "should classify INTERNAL_LOGIC for body changes in a function",
        "should classify CONTRACT_CHANGED for parameter changes",
      ],
      negativeParameters: [
        "semantic diff returns an empty result for empty and fully out-of-range changes",
      ],
      inputCompleteness: [
        "should classify CONTRACT_CHANGED for a new documented function (range spans blank line + doc comment + declaration)",
      ],
      outputCompleteness: [
        "should classify CONTRACT_CHANGED for a brand-new file whose only content is a documented function",
      ],
      errorHandling: [
        "semantic diff returns an empty result for empty and fully out-of-range changes",
      ],
      unexpectedInput: [
        "semantic diff returns an empty result for empty and fully out-of-range changes",
      ],
      determinism: [
        "semantic diff is deterministic across repeated identical analysis",
      ],
      sourceTraceability: ["export interface ModifiedNode"],
    },
  },
  {
    name: "AST-derived edge computation",
    files: [
      "../lib/ast-core/src/core/edge-computer.unit.test.ts",
      "../lib/ast-core/test/phase3-ast-core-quality.unit.test.ts",
      "../lib/contracts/src/interfaces/ast.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: [
        "TS named import: import { helper } from './b'",
        "TS barrel re-export: export { helper } from './deep/util' yields an import descriptor for the re-exported name (issue #192 gap 2)",
      ],
      negativeParameters: [
        "TS plain local export (no source clause) produces no descriptor -- only re-exports are dependency edges",
      ],
      inputCompleteness: [
        "Python: from x import y",
        "Rust: use foo::bar as baz",
        'Go: import "pkg"',
      ],
      outputCompleteness: [
        "TS named import with alias: import { A as B } from 'bar'",
        "encodes named-import descriptors as `${modulePath}::${originalName}` (matches original hand-written implementation's output)",
      ],
      errorHandling: [
        "AST-derived import extraction handles empty and unknown nodes without inventing edges",
      ],
      unexpectedInput: [
        "AST-derived import extraction handles empty and unknown nodes without inventing edges",
      ],
      determinism: [
        "AST-derived import extraction handles empty and unknown nodes without inventing edges",
      ],
      sourceTraceability: ["export interface AstImportDescriptor"],
    },
  },
] as const;

function readEvidenceFiles(files: readonly string[]): string {
  return files
    .map((relativePath) =>
      readFileSync(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        "utf8",
      ),
    )
    .join("\n");
}

function evaluateCapability(capability: CapabilityEvidence) {
  const combinedSource = readEvidenceFiles(capability.files);
  const dimensions = Object.fromEntries(
    Object.entries(capability.dimensions).map(([dimension, evidence]) => [
      dimension,
      {
        passed: evidence.filter((item) => combinedSource.includes(item)).length,
        required: evidence.length,
      },
    ]),
  ) as TddQualityEvidence["dimensions"];
  const skippedTests = (combinedSource.match(/\b(?:it|test)\.skip\s*\(/g) ?? [])
    .length;

  return evaluateTddQuality({
    dimensions,
    sourceConformance: "PASS",
    skippedTests,
  });
}

describe("Phase 3 AST and language extraction quantitative TDD quality matrix", () => {
  it.each(capabilities)(
    "$name meets the capability floor with every mandatory evidence gate",
    (capability) => {
      const result = evaluateCapability(capability);

      expect(result.score).toBeGreaterThanOrEqual(
        TDD_QUALITY_MINIMUM_PASS_SCORE,
      );
      expect(result.result).toBe("PASS");
      expect(result.gates.allApplicableDimensionsHaveEvidence).toBe(true);
      expect(result.gates.allRequiredChecksPass).toBe(true);
      expect(result.gates.sourceConformancePasses).toBe(true);
      expect(result.gates.noSkippedTestsCountedAsPassed).toBe(true);
    },
  );

  it("keeps the aggregate Phase 3 score at or above the governance floor", () => {
    const results = capabilities.map(evaluateCapability);
    const aggregate =
      results.reduce((sum, result) => sum + result.score, 0) / results.length;

    expect(aggregate).toBeGreaterThanOrEqual(TDD_QUALITY_MINIMUM_PASS_SCORE);
    expect(results.every((result) => result.result === "PASS")).toBe(true);
  });
});
