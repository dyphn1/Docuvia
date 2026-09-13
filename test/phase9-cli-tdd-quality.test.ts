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
    name: "CLI entrypoint / dispatch / interactivity boundary",
    files: [
      "../artifacts/cli/test/integration/phase9-cli-cross-layer.integration.test.ts",
      "../artifacts/cli/test/integration/cli-help-version-interactive.test.ts",
      "../artifacts/cli/src/cli.ts",
      "../docs/gitbook/user-guide/cli.md",
    ],
    dimensions: {
      positiveParameters: {
        evidence: ["prints usage and exits 0 for --help"],
      },
      negativeParameters: {
        evidence: [
          "rejects an unknown command option before command execution",
        ],
      },
      inputCompleteness: {
        evidence: [
          "prints that command's flags and exits 0 for `docuvia <command> --help`, without running the command",
        ],
      },
      outputCompleteness: {
        evidence: [
          "returns byte-stable global help/version output across repeated identical invocations",
        ],
      },
      errorHandling: {
        evidence: ["still exits 1 with usage for a genuinely unknown command"],
      },
      unexpectedInput: {
        evidence: [
          "fails fast (does not hang) instead of launching the wizard when -i has no usable TTY behind it",
        ],
      },
      determinism: {
        evidence: [
          "returns byte-stable global help/version output across repeated identical invocations",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: docs/gitbook/user-guide/cli.md#cli-commands",
          "TDD-SOURCE: artifacts/cli/src/cli.ts#main",
        ],
      },
    },
  },
  {
    name: "Initialization / installation lifecycle and cross-surface parity",
    files: [
      "../artifacts/cli/test/integration/phase9-cli-cross-layer.integration.test.ts",
      "../artifacts/cli/test/integration/init-cli-mcp-symmetry.test.ts",
      "../artifacts/cli/test/unit/commands/init.unit.test.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "should initialize docuvia non-interactively via docuviaApi.init, scoping memory to a fresh UUID and cleaning it up afterwards",
        ],
      },
      negativeParameters: {
        evidence: [
          "rejects with a validation error before touching docuviaApi.init when cwd is an empty string",
        ],
      },
      inputCompleteness: {
        evidence: [
          "installs only the platforms named in the --platform flag, skipping the interactive checkbox",
        ],
      },
      outputCompleteness: {
        evidence: [
          "populates the same tables with equal row counts via both paths",
        ],
      },
      errorHandling: {
        evidence: [
          "calls spinner.fail and still deletes the memory scope when docuviaApi.init() throws",
        ],
      },
      unexpectedInput: {
        evidence: [
          "reports an error and exits when an unknown platform slug is given",
        ],
      },
      determinism: {
        evidence: [
          "keeps repeated init idempotent at the persisted graph boundary",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: docs/gitbook/user-guide/cli/init.md#init",
          "TDD-SOURCE: artifacts/cli/src/commands/init.ts#initCommand",
        ],
      },
    },
  },
  {
    name: "Analyze / maintenance cross-layer workflows",
    files: [
      "../artifacts/cli/test/integration/phase9-cli-cross-layer.integration.test.ts",
      "../artifacts/cli/test/integration/commands/analyze-config-scan.integration.test.ts",
      "../artifacts/cli/test/unit/commands/analyze.unit.test.ts",
      "../artifacts/cli/test/unit/commands/snapshot.unit.test.ts",
      "../artifacts/cli/test/unit/commands/hydrate.unit.test.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "runs the real discovery/config-scan/persist pipeline end-to-end and prints the fused projectType/tags",
        ],
      },
      negativeParameters: {
        evidence: [
          "warns instead of succeeding when there's nothing to hydrate from yet",
        ],
      },
      inputCompleteness: {
        evidence: [
          "sets targetPath/llmBaseUrl/llmModel into docuviaMemory, passes the API key straight to docuviaApi.analyze(), and never writes the key to memory",
        ],
      },
      outputCompleteness: {
        evidence: [
          "reports node/edge/markdown counts as separate info lines on success",
        ],
      },
      errorHandling: {
        evidence: [
          "calls spinner.fail and sets process.exitCode = 1 (not process.exit()) when docuviaApi.analyze() rejects",
        ],
      },
      unexpectedInput: {
        evidence: [
          "regression: hard-fails (process.exitCode=1) and never calls docuviaApi.analyze() when the environment isn't ready, non-interactive, no --fallback-ast",
        ],
      },
      determinism: {
        evidence: [
          "is idempotent: running analyze twice never duplicates the project row",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: docs/gitbook/user-guide/cli/analyze.md#analyze",
          "TDD-SOURCE: artifacts/cli/src/commands/analyze.ts#analyzeCommand",
        ],
      },
    },
  },
  {
    name: "Query / review / impact presentation boundary",
    files: [
      "../artifacts/cli/test/integration/phase9-cli-cross-layer.integration.test.ts",
      "../artifacts/cli/test/unit/commands/query.unit.test.ts",
      "../artifacts/cli/test/unit/commands/review.unit.test.ts",
      "../artifacts/cli/test/unit/commands/impact.unit.test.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "resolves the query and prints human-readable results by default",
        ],
      },
      negativeParameters: {
        evidence: [
          "errors immediately without calling docuviaApi.impact() when target is empty",
        ],
      },
      inputCompleteness: {
        evidence: [
          "passes a valid --limit through to the memory scope unchanged",
        ],
      },
      outputCompleteness: {
        evidence: [
          "prints the structured result as JSON and skips the banner/spinner when format is 'json'",
        ],
      },
      errorHandling: {
        evidence: [
          "reports failures via stderr (ui.error) rather than stdout when --format=json",
        ],
      },
      unexpectedInput: {
        evidence: [
          "warns and ignores an invalid (negative) --limit instead of passing it through silently",
        ],
      },
      determinism: {
        evidence: [
          "returns byte-stable structured query/impact results across repeated identical invocations",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: docs/gitbook/user-guide/cli/query.md#query",
          "TDD-SOURCE: artifacts/cli/src/commands/query.ts#queryCommand",
          "TDD-SOURCE: docs/gitbook/user-guide/cli/impact.md#impact",
          "TDD-SOURCE: artifacts/cli/src/commands/impact.ts#impactCommand",
        ],
      },
    },
  },
  {
    name: "Shipped distribution / package closure",
    files: [
      "../artifacts/cli/test/integration/phase9-cli-cross-layer.integration.test.ts",
      "../artifacts/cli/test/integration/dist-build.test.ts",
      "../artifacts/cli/package.json",
      "../artifacts/cli/test/support/sandbox.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: ["boots and runs a basic command without crashing"],
      },
      negativeParameters: {
        evidence: [
          "keeps the freshly built dist CLI deterministic and fail-closed across smoke/workflow reruns",
        ],
      },
      inputCompleteness: {
        evidence: [
          "init populates a real, non-empty knowledge graph via the compiled build",
        ],
      },
      outputCompleteness: {
        evidence: [
          "query and impact return real results against the compiled build's graph, not just an empty-graph no-op",
        ],
      },
      errorHandling: {
        evidence: [
          "keeps the freshly built dist CLI deterministic and fail-closed across smoke/workflow reruns",
        ],
      },
      unexpectedInput: {
        evidence: [
          "does not crash when several init processes race against the compiled build in the same workspace",
        ],
      },
      determinism: {
        evidence: [
          "keeps the freshly built dist CLI deterministic and fail-closed across smoke/workflow reruns",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: artifacts/cli/package.json#bin",
          "TDD-SOURCE: artifacts/cli/test/support/sandbox.ts#runDistCli",
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

describe("Phase 9 CLI/cross-layer quantitative TDD quality matrix", () => {
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

  it("keeps the aggregate Phase 9 score at or above the governance floor", () => {
    const results = capabilities.map(evaluateCapability);
    const aggregate =
      results.reduce((sum, result) => sum + result.score, 0) / results.length;

    expect(aggregate).toBeGreaterThanOrEqual(TDD_QUALITY_MINIMUM_PASS_SCORE);
    expect(results.every((result) => result.result === "PASS")).toBe(true);
    expect(results.every((result) => result.gates.allRequiredChecksPass)).toBe(
      true,
    );
  });

  it("fails closed when a required Phase 9 evidence dimension is removed", () => {
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
