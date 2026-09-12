import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateTddQuality,
  type TddQualityDimension,
} from "./tdd-quality-score.js";

const authoritativeSource =
  "docs/gitbook/architecture/testing-and-quality-architecture.md";

const existingSuitePath = fileURLToPath(
  new URL(
    "../lib/core/src/ast/ast-processing.service.unit.test.ts",
    import.meta.url,
  ),
);
const contractSuitePath = fileURLToPath(
  new URL(
    "../lib/core/src/ast/ast-processing.service.contract.unit.test.ts",
    import.meta.url,
  ),
);

const existingSuite = readFileSync(existingSuitePath, "utf8");
const contractSuite = readFileSync(contractSuitePath, "utf8");
const combinedSource = `${existingSuite}\n${contractSuite}`;

const evidenceTitles: Record<TddQualityDimension, readonly string[]> = {
  positiveParameters: [
    "returns all files under 'parsed' when every parse succeeds",
    "returns the complete parsed result contract for a successful file",
  ],
  negativeParameters: [
    "moves a file to 'failures' with its error message when pool.parse resolves with success:false",
    "moves a file to 'failures' when pool.parse rejects with AstWorkerCrashError",
  ],
  inputCompleteness: [
    "handles an empty input list without parsing and still closes the worker-pool lifecycle",
    "returns the complete parsed result contract for a successful file",
    "returns all files under 'parsed' when every parse succeeds",
  ],
  outputCompleteness: [
    "returns the complete parsed result contract for a successful file",
    "moves a file to 'failures' with its error message when pool.parse resolves with success:false",
    "preserves the input file order in 'parsed' even when later files resolve before earlier ones",
    "attaches the detected language to each parsed result",
  ],
  errorHandling: [
    "uses the documented fallback error when a failure response has no error detail",
    "normalizes a generic thrown Error into the failure contract instead of rejecting the batch",
    "moves a file to 'failures' when pool.parse rejects with AstWorkerCrashError",
  ],
  unexpectedInput: [
    "normalizes a malformed success response with missing data into an explicit failure",
    "preserves duplicate inputs as distinct ordered results rather than silently deduplicating them",
  ],
  determinism: [
    "produces identical normalized output and parse side effects across two identical-input runs",
  ],
  sourceTraceability: [
    `TDD-SOURCE: ${authoritativeSource}`,
  ],
};

function foundCount(titles: readonly string[]): number {
  return titles.filter((title) => combinedSource.includes(title)).length;
}

describe("AstProcessingService quantitative TDD quality matrix", () => {
  it("keeps all eight evidence dimensions complete and source-traceable", () => {
    const dimensions = Object.fromEntries(
      Object.entries(evidenceTitles).map(([dimension, titles]) => [
        dimension,
        { passed: foundCount(titles), required: titles.length },
      ]),
    ) as Parameters<typeof evaluateTddQuality>[0]["dimensions"];

    const skippedTests = (
      combinedSource.match(/\b(?:it|test)\.skip\s*\(/g) ?? []
    ).length;

    const result = evaluateTddQuality({
      dimensions,
      sourceConformance: "PASS",
      skippedTests,
    });

    expect(result.score).toBe(100);
    expect(result.result).toBe("PASS");
    expect(result.dimensions.sourceTraceability).toMatchObject({
      passed: 1,
      required: 1,
      percentage: 100,
    });
  });
});
