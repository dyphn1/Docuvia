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
    name: "Impact target resolution and blast radius",
    files: [
      "../lib/core/src/impact/impact.service.unit.test.ts",
      "../lib/core/src/impact/impact.service.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: ["returns the 1-hop set of nodes that depend on the resolved target"],
      },
      negativeParameters: {
        evidence: ["returns undefined when the target does not resolve to any node"],
      },
      inputCompleteness: {
        evidence: ["resolves the target via LIKE fallback when there is no exact name match"],
      },
      outputCompleteness: {
        evidence: ["includes callers from different edge types (calls, extends, implements)"],
      },
      errorHandling: {
        evidence: [],
        naReason:
          "getBlastRadius() is a synchronous graph read and declares no local recovery contract; repository failures intentionally propagate to the API boundary.",
      },
      unexpectedInput: {
        evidence: ["returns an empty array when the node exists but has no incoming edges"],
      },
      determinism: {
        evidence: ["returns identical blast-radius entries across repeated identical reads"],
      },
      sourceTraceability: {
        evidence: ["TDD-SOURCE: lib/contracts/src/interfaces/impact.interfaces.ts"],
      },
    },
  },
  {
    name: "Dynamic-call fallback and confidence provenance",
    files: [
      "../lib/core/src/impact/impact.service.unit.test.ts",
      "../lib/core/src/impact/impact.service.ts",
      "../lib/schema/src/sqlite/repos/call-sites-repo.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: ["appends lsp-fallback entries from reverse-read call sites when no static caller edge exists"],
      },
      negativeParameters: {
        evidence: ["does not query call sites at all when a real static caller edge exists (fallback fires only when needed)"],
      },
      inputCompleteness: {
        evidence: ["recovers unresolved receiver calls through the terminal callee name"],
      },
      outputCompleteness: {
        evidence: ["attaches L3 'why' data to an lsp-fallback entry like a static one"],
      },
      errorHandling: {
        evidence: [],
        naReason:
          "The fallback is a read-only best-effort path over ICallSitesRepo; storage failures intentionally propagate rather than being converted into false-safe empty impact.",
      },
      unexpectedInput: {
        evidence: ["skips the target's own file and files absent from the graph, and never trusts a LIKE match as the dependent node"],
      },
      determinism: {
        evidence: ["returns identical lsp-fallback entries across repeated identical reads"],
      },
      sourceTraceability: {
        evidence: ["TDD-SOURCE: lib/contracts/src/interfaces/impact.interfaces.ts"],
      },
    },
  },
  {
    name: "Risk scoring",
    files: [
      "../lib/core/src/impact/impact.service.unit.test.ts",
      "../lib/core/src/impact/impact.service.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: ["returns HIGH at/above the HIGH threshold, below CRITICAL"],
      },
      negativeParameters: {
        evidence: ["returns LOW for zero impacted nodes"],
      },
      inputCompleteness: {
        evidence: ["reads store.graph.count().l2Nodes and threads it into the scaled formula (above-reference branch)"],
      },
      outputCompleteness: {
        evidence: ["returns CRITICAL at/above the CRITICAL threshold"],
      },
      errorHandling: {
        evidence: [],
        naReason:
          "computeRiskLevelFromCounts() is pure arithmetic over validated graph counts and declares no error/recovery path.",
      },
      unexpectedInput: {
        evidence: ["does not divide by zero or propagate NaN for a freshly-init'd, not-yet-ingested graph (totalNodeCount 0)"],
      },
      determinism: {
        evidence: ["never decreases the effective HIGH/CRITICAL thresholds as totalNodeCount grows (monotonicity)"],
      },
      sourceTraceability: {
        evidence: ["TDD-SOURCE: lib/contracts/src/interfaces/impact.interfaces.ts"],
      },
    },
  },
  {
    name: "Impact accuracy benchmark and regression gate",
    files: [
      "../artifacts/cli/test/integration/commands/impact-eval.integration.test.ts",
      "../artifacts/cli/test/support/impact-eval-scorer.ts",
      "../artifacts/cli/test/support/impact-corpus.ts",
      "../.github/workflows/eval.yml",
    ],
    dimensions: {
      positiveParameters: {
        evidence: ["scores the control static-call case perfectly"],
      },
      negativeParameters: {
        evidence: ["fails the regression gate when mean F1 drops below the locked baseline"],
      },
      inputCompleteness: {
        evidence: ["scores the real docuvia impact JSON result for every golden case"],
      },
      outputCompleteness: {
        evidence: ["produced a scored row for every golden case (errors included, never dropped)"],
      },
      errorHandling: {
        evidence: ["keeps the harness honest: no case silently errored"],
      },
      unexpectedInput: {
        evidence: ["keeps an unresolved target visible as an empty prediction rather than dropping the case"],
      },
      determinism: {
        evidence: ["produces identical scores across repeated impact evaluation of the same corpus"],
      },
      sourceTraceability: {
        evidence: ["TDD-SOURCE: issue #192 impact accuracy acceptance criteria"],
      },
    },
  },
] as const;

function readEvidenceFiles(files: readonly string[]): string {
  return files
    .map((relativePath) =>
      readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"),
    )
    .join("\n");
}

function evaluateCapability(capability: CapabilityEvidence) {
  const combinedSource = readEvidenceFiles(capability.files);
  const dimensions = Object.fromEntries(
    Object.entries(capability.dimensions).map(([dimension, spec]) => [
      dimension,
      {
        passed: spec.evidence.filter((item) => combinedSource.includes(item)).length,
        required: spec.evidence.length,
        naReason: spec.naReason,
      },
    ]),
  ) as TddQualityEvidence["dimensions"];
  const skippedTests = (combinedSource.match(/\b(?:it|test)\.skip\s*\(/g) ?? []).length;

  return evaluateTddQuality({
    dimensions,
    sourceConformance: "PASS",
    skippedTests,
  });
}

describe("Phase 6 impact and reliability quantitative TDD quality matrix", () => {
  it.each(capabilities)(
    "$name meets the capability floor with every mandatory evidence gate",
    (capability) => {
      const result = evaluateCapability(capability);
      expect(result.score).toBeGreaterThanOrEqual(TDD_QUALITY_MINIMUM_PASS_SCORE);
      expect(result.result).toBe("PASS");
      expect(result.gates.allApplicableDimensionsHaveEvidence).toBe(true);
      expect(result.gates.allRequiredChecksPass).toBe(true);
      expect(result.gates.sourceConformancePasses).toBe(true);
      expect(result.gates.noSkippedTestsCountedAsPassed).toBe(true);
    },
  );

  it("keeps the aggregate Phase 6 score at or above the governance floor", () => {
    const results = capabilities.map(evaluateCapability);
    const aggregate =
      results.reduce((sum, result) => sum + result.score, 0) / results.length;

    expect(aggregate).toBeGreaterThanOrEqual(TDD_QUALITY_MINIMUM_PASS_SCORE);
    expect(results.every((result) => result.result === "PASS")).toBe(true);
    expect(results.every((result) => result.gates.allRequiredChecksPass)).toBe(true);
  });
});
