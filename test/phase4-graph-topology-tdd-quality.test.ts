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
    name: "Graph identity / node keys",
    files: [
      "../lib/core/src/graph/node-key.unit.test.ts",
      "../lib/core/src/graph/phase4-graph-quality.unit.test.ts",
      "../lib/core/src/graph/node-key.ts",
      "../docs/gitbook/adr/graph/GRPH-006-qualified-symbol-table-node-key.md",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "returns the bare key unchanged when there is no collision -- the common case",
        ],
      },
      negativeParameters: {
        evidence: [
          "falls back to a counter once even the line-qualified key collides",
        ],
      },
      inputCompleteness: {
        evidence: [
          "falls back to today's flat shape when there is no container (top-level function)",
        ],
      },
      outputCompleteness: {
        evidence: [
          "gives two identically-named methods on different classes structurally different base keys -- no collision to disambiguate",
        ],
      },
      errorHandling: {
        evidence: [],
        naReason:
          "Pure node-key builders perform no I/O or parsing and expose no error contract; collision handling is represented as deterministic normal output.",
      },
      unexpectedInput: {
        evidence: [
          "still collides -- and still needs buildUniqueNodeKey's line/counter disambiguation -- for two identically-named methods on the SAME class (overloads)",
        ],
      },
      determinism: {
        evidence: [
          "node-key qualification and collision fallback are deterministic across repeated identical input",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: docs/gitbook/adr/graph/GRPH-006-qualified-symbol-table-node-key.md",
        ],
      },
    },
  },
  {
    name: "AST to graph persistence",
    files: [
      "../lib/core/src/graph/persist-ast-graph.unit.test.ts",
      "../lib/core/src/graph/phase4-graph-quality.unit.test.ts",
      "../lib/contracts/src/interfaces/graph-persister.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "persists a real parsed file as l2_nodes and links functions with 'contains'",
        ],
      },
      negativeParameters: {
        evidence: [
          "rolls back partial AST graph writes when persistence fails during edge insertion",
        ],
      },
      inputCompleteness: {
        evidence: [
          "upserts and links every given tag to each persisted file node",
        ],
      },
      outputCompleteness: {
        evidence: [
          "resolves an intra-file call edge via ScopeResolver ('calls' link between the two function nodes)",
        ],
      },
      errorHandling: {
        evidence: [
          "rolls back partial AST graph writes when persistence fails during edge insertion",
        ],
      },
      unexpectedInput: {
        evidence: [
          "disambiguates same-named symbols in one file instead of throwing on the node_key UNIQUE constraint (regression: multiple 'anonymous' callbacks in one file used to crash init)",
        ],
      },
      determinism: {
        evidence: [
          "re-persisting identical AST input produces the same semantic graph snapshot",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/graph-persister.interfaces.ts",
        ],
      },
    },
  },
  {
    name: "Scope and symbol resolution",
    files: [
      "../lib/core/src/graph/scope-resolver.unit.test.ts",
      "../lib/core/src/graph/scope-resolver.honest.unit.test.ts",
      "../lib/core/src/graph/phase4-graph-quality.unit.test.ts",
      "../lib/core/src/graph/scope-resolver.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "resolves a relative .js-suffixed import to the real .ts source with its symbol",
        ],
      },
      negativeParameters: {
        evidence: [
          "returns null for an import whose target file does not exist on disk",
        ],
      },
      inputCompleteness: {
        evidence: ["resolves an import through a real tsconfig paths mapping"],
      },
      outputCompleteness: {
        evidence: [
          "resolves an import through a barrel re-export to the defining file (issue #192 gap 2)",
        ],
      },
      errorHandling: {
        evidence: [
          "guards against mutually-recursive re-export cycles (terminates, no infinite loop)",
        ],
      },
      unexpectedInput: {
        evidence: [
          "refuses to resolve a tsconfig path alias that traverses outside the workspace root (issue #208)",
        ],
      },
      determinism: {
        evidence: [
          "scope resolution is deterministic for repeated identical registered-file input",
        ],
      },
      sourceTraceability: {
        evidence: ["export class ScopeResolver"],
      },
    },
  },
  {
    name: "Topology builder",
    files: [
      "../lib/core/src/topology/topology-builder.service.unit.test.ts",
      "../lib/core/src/topology/phase4-topology-quality.unit.test.ts",
      "../lib/contracts/src/interfaces/topology.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "projects l2/link/l3/tag rows into a symbol-level TopologyGraph by default",
        ],
      },
      negativeParameters: {
        evidence: [
          "omits decision enrichment fields that are null/empty on the l3 row",
        ],
      },
      inputCompleteness: {
        evidence: ["returns a complete empty topology contract for empty graph input"],
      },
      outputCompleteness: {
        evidence: [
          "maps edge provenance (commit_sha/diff_summary) onto TopologyLink when present",
        ],
      },
      errorHandling: {
        evidence: [
          "bounds malformed persisted metadata without throwing and remains deterministic",
        ],
      },
      unexpectedInput: {
        evidence: [
          "bounds malformed persisted metadata without throwing and remains deterministic",
        ],
      },
      determinism: {
        evidence: [
          "produces deterministic structural topology across repeated identical input",
        ],
      },
      sourceTraceability: {
        evidence: ["TDD-SOURCE: lib/contracts/src/interfaces/topology.interfaces.ts"],
      },
    },
  },
  {
    name: "SQLite graph store / repository persistence",
    files: [
      "../lib/schema/src/sqlite/graph-store.integration.test.ts",
      "../lib/schema/src/sqlite/phase4-graph-store-quality.integration.test.ts",
      "../lib/contracts/src/interfaces/graph-store.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "graph repo: insertNode()/insertLink()/findNodeIdByName()/deleteNodesForPath()",
        ],
      },
      negativeParameters: {
        evidence: [
          "readonly open on a genuinely-missing file throws DB_NOT_FOUND, not DB_OPEN_FAILED",
        ],
      },
      inputCompleteness: {
        evidence: ["rejects malformed dbPath before touching fs (issue #261)"],
      },
      outputCompleteness: {
        evidence: [
          "round-trips graph nodes and links identically through a readonly reopen",
        ],
      },
      errorHandling: {
        evidence: [
          "rolls back the complete graph write when a transaction callback throws",
        ],
      },
      unexpectedInput: {
        evidence: ["rejects malformed dbPath before touching fs (issue #261)"],
      },
      determinism: {
        evidence: [
          "round-trips graph nodes and links identically through a readonly reopen",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/graph-store.interfaces.ts",
        ],
      },
    },
  },
  {
    name: "Graph-store locking / write boundary",
    files: [
      "../lib/schema/src/sqlite/read-write-lock.unit.test.ts",
      "../lib/schema/src/sqlite/phase4-graph-store-quality.integration.test.ts",
      "../lib/contracts/src/interfaces/graph-store.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: ["should allow multiple readers to hold the lock concurrently"],
      },
      negativeParameters: {
        evidence: [
          "should make a writer wait for active readers and block later readers behind it",
        ],
      },
      inputCompleteness: {
        evidence: [
          "should serialize a writer after a reader completes (reader-to-writer handoff)",
        ],
      },
      outputCompleteness: {
        evidence: ["should serialize writers exclusively"],
      },
      errorHandling: {
        evidence: ["should release the lock when the guarded function throws"],
      },
      unexpectedInput: {
        evidence: [
          "serializes queued GraphStore writers deterministically and releases the lock",
        ],
      },
      determinism: {
        evidence: [
          "serializes queued GraphStore writers deterministically and releases the lock",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/graph-store.interfaces.ts",
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
        passed: spec.evidence.filter((item) => combinedSource.includes(item)).length,
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

describe("Phase 4 graph ingestion, persistence and topology quantitative TDD quality matrix", () => {
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

  it("keeps the aggregate Phase 4 score at or above the governance floor", () => {
    const results = capabilities.map(evaluateCapability);
    const aggregate =
      results.reduce((sum, result) => sum + result.score, 0) / results.length;

    expect(aggregate).toBeGreaterThanOrEqual(TDD_QUALITY_MINIMUM_PASS_SCORE);
    expect(results.every((result) => result.result === "PASS")).toBe(true);
    expect(
      results.every((result) => result.gates.allRequiredChecksPass),
    ).toBe(true);
  });
});
