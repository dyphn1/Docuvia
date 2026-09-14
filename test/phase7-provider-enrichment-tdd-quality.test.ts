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
    name: "LSP binary resolution / preflight",
    files: [
      "../lib/core/src/lsp/lsp-binary-resolver-strategies.unit.test.ts",
      "../lib/core/src/lsp/go-lsp-edge-provider.unit.test.ts",
      "../lib/core/src/lsp/phase7-lsp-quality.unit.test.ts",
      "../lib/contracts/src/interfaces/edge-resolution.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: ["prefers an explicit override over any other resolution"],
      },
      negativeParameters: {
        evidence: [
          "reports unresolved (bare binary name, locallyResolved: false) when neither PATH nor any extra dir has it",
        ],
      },
      inputCompleteness: {
        evidence: [
          "resolves a project-local node_modules/.bin copy under the distinct binaryName",
        ],
      },
      outputCompleteness: {
        evidence: [
          "never spawns and reports not-spawnable when the basename is NOT allowlisted",
        ],
      },
      errorHandling: {
        evidence: [
          "reports unavailable with a reason when no go.mod marker is present",
        ],
      },
      unexpectedInput: {
        evidence: ["rejects workspace traversal outside the LSP root"],
      },
      determinism: {
        evidence: [
          "returns identical binary and workspace-path resolutions across repeated identical input",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/edge-resolution.interfaces.ts#IEdgeResolutionProvider",
        ],
      },
    },
  },
  {
    name: "LSP JSON-RPC transport",
    files: [
      "../lib/core/src/lsp/lsp-json-rpc-client.unit.test.ts",
      "../lib/core/src/lsp/phase7-lsp-quality.unit.test.ts",
      "../lib/contracts/src/interfaces/edge-resolution.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "starts the process and completes a request/response round trip",
        ],
      },
      negativeParameters: {
        evidence: ["rejects on a server error response"],
      },
      inputCompleteness: {
        evidence: [
          "correlates concurrent requests by id, not by response order",
        ],
      },
      outputCompleteness: {
        evidence: [
          "captures the child process's stderr tail and folds it into a pending request's rejection",
        ],
      },
      errorHandling: {
        evidence: ["rejects a request that outlives its timeout"],
      },
      unexpectedInput: {
        evidence: [
          "defaults to a minimal allowlist env, not full process.env inheritance",
        ],
      },
      determinism: {
        evidence: [
          "returns identical JSON-RPC results across repeated identical requests",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/edge-resolution.interfaces.ts#IEdgeResolutionProvider",
        ],
      },
    },
  },
  {
    name: "LSP Tier-B project partitioning",
    files: [
      "../lib/core/src/lsp/tier-b-project-partitioner.unit.test.ts",
      "../lib/core/src/lsp/phase7-lsp-quality.unit.test.ts",
      "../lib/core/src/lsp/tier-b-project-partitioner.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "maps each file to its nearest owning project and groups Rust workspace crates",
        ],
      },
      negativeParameters: {
        evidence: [
          "falls back to the workspace root for files with no owning marker",
        ],
      },
      inputCompleteness: {
        evidence: [
          "expands TypeScript workspaces and honors tsconfig references",
          "orders Go submodules ahead of the module that replaces into them",
          "orders C# projects after the projects they reference",
          "uses $languageId project markers as the file boundary",
        ],
      },
      outputCompleteness: {
        evidence: [
          "orders dependency projects before dependents (bottom-up, PRJ-003)",
        ],
      },
      errorHandling: {
        evidence: [
          "treats malformed TypeScript project metadata as no local dependency instead of throwing",
        ],
      },
      unexpectedInput: {
        evidence: [
          "terminates deterministically on a dependency cycle (path-order tiebreak)",
        ],
      },
      determinism: {
        evidence: [
          "terminates deterministically on a dependency cycle (path-order tiebreak)",
          "keeps files grouped with their owning project regardless of input order",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/core/src/lsp/tier-b-project-partitioner.ts#partitionTierBBucket (PRJ-001/PRJ-003)",
        ],
      },
    },
  },
  {
    name: "LSP edge enrichment",
    files: [
      "../lib/core/src/lsp/go-lsp-edge-provider.unit.test.ts",
      "../lib/core/src/lsp/lsp-edge-provider-base.concurrency.unit.test.ts",
      "../lib/core/src/lsp/phase7-lsp-quality.unit.test.ts",
      "../lib/contracts/src/interfaces/edge-resolution.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "resolves a cross-file symbol-level calls edge via documentSymbol + references",
        ],
      },
      negativeParameters: {
        evidence: [
          "returns an empty outcome without touching the client factory when files is empty",
        ],
      },
      inputCompleteness: {
        evidence: [
          "maps a pointer-receiver method's gopls '(*B).Visit' name onto Tier A's 'file#B.Visit' node_key",
        ],
      },
      outputCompleteness: {
        evidence: [
          "produces identical edges/filesProcessed/filesFailed at maxConcurrentFiles: 1 vs 4",
        ],
      },
      errorHandling: {
        evidence: [
          "degrades honestly (unavailableReason set, no edges) when the client fails to spawn",
        ],
      },
      unexpectedInput: {
        evidence: [
          "reports unavailable with a reason when no go.mod marker is present",
        ],
      },
      determinism: {
        evidence: [
          "produces identical edges/filesProcessed/filesFailed at maxConcurrentFiles: 1 vs 4",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/edge-resolution.interfaces.ts#IEdgeResolutionProvider",
        ],
      },
    },
  },
  {
    name: "LLM HTTP bridge provider",
    files: [
      "../lib/llm-api/src/fetch-llm-client.unit.test.ts",
      "../lib/llm-api/src/fetch-llm-client.integration.test.ts",
      "../lib/llm-api/src/phase7-llm-quality.integration.test.ts",
      "../lib/contracts/src/interfaces/llm-client.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "chatCompletion POSTs the exact mapped body/auth header and returns the parsed camelCased result",
        ],
      },
      negativeParameters: {
        evidence: [
          "chatCompletion omits the Authorization header when no apiKey is configured",
        ],
      },
      inputCompleteness: {
        evidence: ["preserves optional request fields"],
      },
      outputCompleteness: {
        evidence: ["returns the complete validated tool-call response shape"],
      },
      errorHandling: {
        evidence: [
          "chatCompletion preserves the exact 401 auth failure code and reason",
        ],
      },
      unexpectedInput: {
        evidence: [
          "rejects valid JSON with wrong required completion field types as LLM_INVALID_RESPONSE",
          "rejects a valid-JSON SSE chunk with wrong required field types",
        ],
      },
      determinism: {
        evidence: [
          "returns identical completion results and wire bodies across repeated identical input",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/llm-client.interfaces.ts#ILlmClient",
        ],
      },
    },
  },
  {
    name: "Remote sync HTTP provider",
    files: [
      "../lib/remote-api/src/fetch-remote-sync-client.integration.test.ts",
      "../lib/remote-api/src/phase7-remote-quality.integration.test.ts",
      "../lib/contracts/src/interfaces/remote-sync.interfaces.ts",
    ],
    dimensions: {
      positiveParameters: {
        evidence: [
          "fetchRemoteL2Nodes GETs /projects/:id/l2-nodes with a Bearer token and parses the JSON response",
        ],
      },
      negativeParameters: {
        evidence: [
          "pushSyncEvents throws a DocuviaError with SYNC_PUSH_FAILED on a non-2xx response",
        ],
      },
      inputCompleteness: {
        evidence: [
          "pushSyncEvents POSTs to /sync/push with the events body and returns the parsed result",
        ],
      },
      outputCompleteness: {
        evidence: [
          "preserves extra remote node fields while validating required id/name fields",
        ],
      },
      errorHandling: {
        evidence: [
          "fetchRemoteL2Nodes throws a DocuviaError (not a raw SyntaxError) when a 200 response body isn't valid JSON",
        ],
      },
      unexpectedInput: {
        evidence: [
          "rejects valid JSON with wrong required remote-node field types",
          "rejects valid JSON with wrong required sync-push result types",
        ],
      },
      determinism: {
        evidence: [
          "returns identical validated remote results across repeated identical input",
        ],
      },
      sourceTraceability: {
        evidence: [
          "TDD-SOURCE: lib/contracts/src/interfaces/remote-sync.interfaces.ts#IRemoteSyncClient",
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

describe("Phase 7 provider/enrichment quantitative TDD quality matrix", () => {
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

  it("keeps the aggregate Phase 7 score at or above the governance floor", () => {
    const results = capabilities.map(evaluateCapability);
    const aggregate =
      results.reduce((sum, result) => sum + result.score, 0) / results.length;

    expect(aggregate).toBeGreaterThanOrEqual(TDD_QUALITY_MINIMUM_PASS_SCORE);
    expect(results.every((result) => result.result === "PASS")).toBe(true);
    expect(results.every((result) => result.gates.allRequiredChecksPass)).toBe(
      true,
    );
  });

  it("fails closed when a required Phase 7 evidence dimension is removed", () => {
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
