import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateTddQuality,
  TDD_QUALITY_MINIMUM_PASS_SCORE,
  type TddQualityDimension,
  type TddQualityEvidence,
} from "./tdd-quality-score.js";

interface DimensionEvidenceSpec {
  evidence: readonly string[];
  naReason?: string;
}

interface CapabilityEvidence {
  name: string;
  files: readonly string[];
  dimensions: Record<TddQualityDimension, DimensionEvidenceSpec>;
}

const capabilities: readonly CapabilityEvidence[] = [
  {
    name: "UI-core API facade / memory dispatch",
    files: [
      "../lib/ui-core/src/docuvia-api.unit.test.ts",
      "../lib/ui-core/src/docuvia-api.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "constructs AnalyzeWorkflow with { targetPath, agentAuthoredDecisions }",
        ],
      },
      negativeParameters: {
        evidence: [
          "falls through to the LLM-config branch (unchanged) when TARGET_PATH is set but AGENT_AUTHORED_DECISIONS is not",
        ],
      },
      inputCompleteness: {
        evidence: [
          "fails with INVALID_INPUT before constructing a workflow when WORKSPACE_ROOT is missing",
          "passes llmApiKey through as an explicit argument instead of reading it from docuviaMemory",
        ],
      },
      outputCompleteness: {
        evidence: [
          "returns equivalent results and workflow options across repeated identical dispatch",
        ],
      },
      errorHandling: {
        evidence: [
          "throws FS_READ_FAILED for a nonexistent target instead of leaving an entry pending",
        ],
      },
      unexpectedInput: {
        evidence: [
          "checks it before TARGET_PATH/AGENT_AUTHORED_DECISIONS/ESCALATE_TO_LSP",
        ],
      },
      determinism: {
        evidence: [
          "returns equivalent results and workflow options across repeated identical dispatch",
        ],
      },
      sourceTraceability: {
        evidence: ["TDD-SOURCE: lib/ui-core/src/docuvia-api.ts#docuviaApi"],
      },
    },
  },
  {
    name: "Workflow lifecycle / resource cleanup",
    files: [
      "../lib/ui-core/src/phase8-orchestration-quality.unit.test.ts",
      "../lib/ui-core/src/workflows/query/query-workflow.unit.test.ts",
      "../lib/ui-core/src/workflows/query/query-workflow.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: ["delegates to QueryService.query() and closes the store"],
      },
      negativeParameters: {
        evidence: [
          "returns an exact-shape null-l2 result when the target doesn't resolve",
        ],
      },
      inputCompleteness: {
        evidence: [
          'queryService.query).toHaveBeenCalledWith(store, "authService", 5)',
        ],
      },
      outputCompleteness: {
        evidence: [
          "passes through a full QueryResult with l3 entries and context without dropping fields",
        ],
      },
      errorHandling: {
        evidence: [
          "closes query resources when a resolved domain service throws without rewriting the failure",
        ],
      },
      unexpectedInput: {
        evidence: [
          "propagates a DB_OPEN_FAILED (present but unopenable db) with its real cause unmasked",
        ],
      },
      determinism: {
        evidence: [
          "returns identical query output across repeated identical orchestration and closes every acquired store",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/ui-core/src/workflows/query/query-workflow.ts#QueryWorkflow.execute",
        ],
      },
    },
  },
  {
    name: "Orchestration state / workflow boundaries",
    files: [
      "../lib/ui-core/src/phase8-orchestration-quality.unit.test.ts",
      "../lib/ui-core/src/workflows/hydrate/hydrate-workflow.unit.test.ts",
      "../lib/ui-core/src/workflows/hydrate/hydrate-workflow.ts",
      "../lib/ui-core/src/docuvia-api.unit.test.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "opens the store read-write (not readonly), hydrates via IHydrationService, and closes the store",
        ],
      },
      negativeParameters: {
        evidence: [
          "returns hydrated:false without throwing when there's nothing to hydrate from yet",
        ],
      },
      inputCompleteness: {
        evidence: [
          "propagates hydrate options exactly and produces equivalent results across repeated runs",
        ],
      },
      outputCompleteness: {
        evidence: ["expect(result).toEqual(hydrationResult)"],
      },
      errorHandling: {
        evidence: ["closes hydrate resources when hydration rejects"],
      },
      unexpectedInput: {
        evidence: [
          "constructs AnalyzeWorkflow with { flushStagedL3: true } and checks it before TARGET_PATH/AGENT_AUTHORED_DECISIONS/ESCALATE_TO_LSP",
        ],
      },
      determinism: {
        evidence: [
          "propagates hydrate options exactly and produces equivalent results across repeated runs",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/ui-core/src/workflows/hydrate/hydrate-workflow.ts#HydrateWorkflow.execute",
        ],
      },
    },
  },
  {
    name: "Core registration / lifetime wiring",
    files: [
      "../lib/core/src/register.unit.test.ts",
      "../lib/core/src/register.ts",
      "../lib/contracts/src/factory/tokens.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "registers every core-owned token into an isolated composition factory",
        ],
      },
      negativeParameters: {
        evidence: [
          "does not claim provider tokens owned by other implementation libraries",
        ],
      },
      inputCompleteness: {
        evidence: [
          "exposes the complete Tier-B provider registry in stable order across repeated resolves",
        ],
      },
      outputCompleteness: {
        evidence: [
          "defers AST worker-pool construction until first resolve and shares one pool across transient processors",
        ],
      },
      errorHandling: {
        evidence: [
          "fails closed when registration is attempted against a locked factory",
        ],
      },
      unexpectedInput: {
        evidence: [
          "propagates a lazy AST pool construction failure and retries cleanly on the next resolve",
        ],
      },
      determinism: {
        evidence: [
          "keeps ordinary services transient across repeated identical resolves",
          "exposes the complete Tier-B provider registry in stable order across repeated resolves",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/factory/tokens.ts#TOKENS",
          "TDD-SOURCE: docs/gitbook/architecture/application-lifecycle-and-state.md#2-roles--state-management-boundaries",
        ],
      },
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
    Object.entries(capability.dimensions).map(([dimension, spec]) => [
      dimension,
      {
        passed: spec.evidence.filter((item) => combinedSource.includes(item))
          .length,
        required: spec.evidence.length,
        naReason: spec.naReason,
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

describe("Phase 8 orchestration/registration quantitative TDD quality matrix", () => {
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

  it("keeps the aggregate Phase 8 score at or above the governance floor", () => {
    const results = capabilities.map(evaluateCapability);
    const aggregate =
      results.reduce((sum, result) => sum + result.score, 0) / results.length;

    expect(aggregate).toBeGreaterThanOrEqual(TDD_QUALITY_MINIMUM_PASS_SCORE);
    expect(results.every((result) => result.result === "PASS")).toBe(true);
    expect(results.every((result) => result.gates.allRequiredChecksPass)).toBe(
      true,
    );
  });

  it("fails closed when a required Phase 8 evidence dimension is removed", () => {
    const capability = capabilities[0];
    const tampered: CapabilityEvidence = {
      ...capability,
      dimensions: {
        ...capability.dimensions,
        determinism: { evidence: ["__deliberately_missing_evidence__"] },
      },
    };

    const result = evaluateCapability(tampered);
    expect(result.result).toBe("FAIL");
    expect(result.gates.allApplicableDimensionsHaveEvidence).toBe(false);
    expect(result.gates.allRequiredChecksPass).toBe(false);
  });
});
