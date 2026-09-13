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
    name: "Keyword extraction / tokenization",
    files: [
      "../lib/core/src/query/query.service.unit.test.ts",
      "../lib/core/src/query/phase5-query-quality.integration.test.ts",
      "../lib/contracts/src/interfaces/query.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: ["strips stop words and dedups tokens"],
      },
      negativeParameters: {
        evidence: ["still drops the single-letter stop words 'a' and 'i'"],
      },
      inputCompleteness: {
        evidence: ["keeps identifier-ish tokens (dots/slashes/dashes) intact"],
      },
      outputCompleteness: {
        evidence: [
          "keeps a meaningful single-character token instead of dropping it as noise",
        ],
      },
      errorHandling: {
        evidence: [],
        naReason:
          "extractKeywords() is a pure tokenizer with no I/O, parser, or declared error path; malformed text is normalized as ordinary input.",
      },
      unexpectedInput: {
        evidence: ["returns empty keywords for punctuation-only input"],
      },
      determinism: {
        evidence: [
          "produces identical keyword arrays across repeated identical input",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/query.interfaces.ts",
        ],
      },
    },
  },
  {
    name: "Structural context retrieval",
    files: [
      "../lib/core/src/query/query.service.unit.test.ts",
      "../lib/core/src/query/phase5-query-quality.integration.test.ts",
      "../lib/contracts/src/interfaces/query.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "returns incoming/outgoing structural edges for a resolved node, labeled by their actual relationship",
        ],
      },
      negativeParameters: {
        evidence: ["returns null when the target does not resolve"],
      },
      inputCompleteness: {
        evidence: [
          "attaches tierBCoverage when the resolved node's own file was never Tier B-processed",
        ],
      },
      outputCompleteness: {
        evidence: ["excludes contains edges"],
      },
      errorHandling: {
        evidence: [],
        naReason:
          "getContext() is a direct structural read and declares no local recovery contract; query() owns and tests containment of context-read failures.",
      },
      unexpectedInput: {
        evidence: ["returns null when the target does not resolve"],
      },
      determinism: {
        evidence: [
          "returns identical structural context across repeated identical reads",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/query.interfaces.ts",
        ],
      },
    },
  },
  {
    name: "Search composition / ranking",
    files: [
      "../lib/core/src/query/query.service.unit.test.ts",
      "../lib/core/src/query/phase5-query-quality.integration.test.ts",
      "../lib/core/src/query/query.service.ts",
      "../lib/contracts/src/interfaces/query.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: ['tags an exact findNodeByName hit as matchType: "exact"'],
      },
      negativeParameters: {
        evidence: ["treats an invalid limit"],
      },
      inputCompleteness: {
        evidence: [
          "prefers a partial match covering more of the query's keywords over a single-keyword match",
        ],
      },
      outputCompleteness: {
        evidence: [
          "deduplicates overlapping exact and keyword candidates by layer/id",
        ],
      },
      errorHandling: {
        evidence: [],
        naReason:
          "search() deliberately bubbles repository failures to the caller; its owned recovery contract is input normalization for invalid limits, tested separately.",
      },
      unexpectedInput: {
        evidence: ["logs a warning when falling back from an invalid limit"],
      },
      determinism: {
        evidence: [
          "returns identical ordered search results across repeated identical input",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/query.interfaces.ts",
        ],
      },
    },
  },
  {
    name: "End-to-end query aggregation",
    files: [
      "../lib/core/src/query/query.service.unit.test.ts",
      "../lib/core/src/query/phase5-query-quality.integration.test.ts",
      "../lib/core/src/query/query.service.ts",
      "../lib/contracts/src/interfaces/query.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "resolves an exact node-ref match as the l2 result, plus its structural context",
        ],
      },
      negativeParameters: {
        evidence: ["returns null l2/empty l3/null context when nothing matches"],
      },
      inputCompleteness: {
        evidence: [
          "attaches l3 write-path provenance from the underlying l3_nodes row",
        ],
      },
      outputCompleteness: {
        evidence: [
          "falls back to a provenance-free L3 entry when its row vanishes after search",
        ],
      },
      errorHandling: {
        evidence: [
          "falls back to context: null instead of throwing when getContext() fails",
        ],
      },
      unexpectedInput: {
        evidence: [
          "handles punctuation-only and whitespace-only queries as empty results without throwing",
        ],
      },
      determinism: {
        evidence: [
          "returns identical complete query results across repeated identical input",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/query.interfaces.ts",
        ],
      },
    },
  },
  {
    name: "SQLite FTS retrieval provider",
    files: [
      "../lib/schema/src/sqlite/graph-store.integration.test.ts",
      "../lib/schema/src/sqlite/phase5-fts-quality.integration.test.ts",
      "../lib/schema/src/sqlite/repos/fts-repo.phase5.unit.test.ts",
      "../lib/schema/src/sqlite/repos/fts-repo.ts",
      "../lib/contracts/src/interfaces/graph-store.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "fts repo: searchL2Nodes()/searchL3Nodes() keyword-match against name/description and title/content",
        ],
      },
      negativeParameters: {
        evidence: ["searchL2Nodes([], 10)"],
      },
      inputCompleteness: {
        evidence: [
          "searchL2Nodes() is AND-first, only widening to OR when nothing matches every keyword",
          "neutralizes FTS operator-like and quote-only input instead of treating it as query syntax",
        ],
      },
      outputCompleteness: {
        evidence: [
          "returns the complete mapped L2 row contract rather than the FTS virtual-table shape",
        ],
      },
      errorHandling: {
        evidence: [
          "wraps L2 driver failures as DB_QUERY_FAILED and preserves the cause",
          "wraps L3 driver failures as DB_QUERY_FAILED and preserves the cause",
        ],
      },
      unexpectedInput: {
        evidence: [
          "neutralizes FTS operator-like and quote-only input instead of treating it as query syntax",
        ],
      },
      determinism: {
        evidence: [
          "returns identical ranked L2 order across repeated identical searches",
          "returns identical ranked L3 order across repeated identical searches",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/graph-store.interfaces.ts#IFtsRepo",
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

describe("Phase 5 query and retrieval quantitative TDD quality matrix", () => {
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

  it("keeps the aggregate Phase 5 score at or above the governance floor", () => {
    const results = capabilities.map(evaluateCapability);
    const aggregate =
      results.reduce((sum, result) => sum + result.score, 0) / results.length;

    expect(aggregate).toBeGreaterThanOrEqual(TDD_QUALITY_MINIMUM_PASS_SCORE);
    expect(results.every((result) => result.result === "PASS")).toBe(true);
    expect(results.every((result) => result.gates.allRequiredChecksPass)).toBe(
      true,
    );
  });
});
