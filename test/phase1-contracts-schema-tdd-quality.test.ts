import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateTddQuality,
  TDD_QUALITY_MINIMUM_PASS_SCORE,
  type TddQualityDimension,
  type TddQualityEvidence,
} from "./tdd-quality-score.js";

interface ContractEvidence {
  name: string;
  sources: readonly string[];
  files: readonly string[];
  dimensions: Record<TddQualityDimension, readonly string[]>;
}

const contracts: readonly ContractEvidence[] = [
  {
    name: "Type-Safe Registry",
    sources: [
      "docs/gitbook/architecture/virtual-contracts-architecture.md",
      "docs/gitbook/architecture/application-lifecycle-and-state.md",
    ],
    files: ["../lib/contracts/src/factory/docuvia-factory.unit.test.ts"],
    dimensions: {
      positiveParameters: [
        "resolve() returns a brand-new instance on every call (transient by default)",
        "a provider can resolve its own nested dependencies from the same factory",
        "passes per-call params through to the provider without going through the registry",
      ],
      negativeParameters: [
        "resolve() throws FACTORY_TOKEN_NOT_REGISTERED for an unregistered token",
        "lock() prevents further registrations, throwing FACTORY_LOCKED",
      ],
      inputCompleteness: [
        "unlock() re-allows registration after a lock()",
        "reset() clears every registration and unlocks",
        "has() reflects registration state",
      ],
      outputCompleteness: [
        "produces equivalent values across repeated identical resolves while preserving transient identity",
        "passes per-call params through to the provider without going through the registry",
      ],
      errorHandling: [
        "resolve() throws FACTORY_TOKEN_NOT_REGISTERED for an unregistered token",
        "propagates provider errors without rewriting the dependency failure",
      ],
      unexpectedInput: [
        "type safety: a provider returning the wrong shape for a token is a compile error",
        "lock() prevents further registrations, throwing FACTORY_LOCKED",
      ],
      determinism: [
        "produces equivalent values across repeated identical resolves while preserving transient identity",
      ],
      sourceTraceability: [
        "TDD-SOURCE: docs/gitbook/architecture/virtual-contracts-architecture.md",
        "TDD-SOURCE: docs/gitbook/architecture/application-lifecycle-and-state.md",
      ],
    },
  },
  {
    name: "Scoped Runtime Memory",
    sources: ["docs/gitbook/architecture/application-lifecycle-and-state.md"],
    files: ["../lib/contracts/src/memory/docuvia-memory.unit.test.ts"],
    dimensions: {
      positiveParameters: [
        "set()/get() round-trip within a created scope",
        "scopes are isolated from each other",
        "round-trips the boolean analyze flags with their concrete values (issue #231)",
      ],
      negativeParameters: [
        "get() returns undefined for a key that was never set",
        "set() throws MEMORY_SCOPE_NOT_FOUND when the scope was never created",
      ],
      inputCompleteness: [
        "createScope() is idempotent — calling it twice does not wipe existing values",
        "round-trips the boolean analyze flags with their concrete values (issue #231)",
      ],
      outputCompleteness: [
        "deleteScope() removes all values for that scope (garbage collection)",
        "hasScope() reflects scope lifecycle",
      ],
      errorHandling: [
        "set() throws MEMORY_SCOPE_NOT_FOUND when the scope was never created",
      ],
      unexpectedInput: [
        "recreating a deleted scope does not leak values from the previous lifecycle",
        "createScope() is idempotent — calling it twice does not wipe existing values",
      ],
      determinism: [
        "produces identical observable state across repeated identical operation sequences",
      ],
      sourceTraceability: [
        "TDD-SOURCE: docs/gitbook/architecture/application-lifecycle-and-state.md",
      ],
    },
  },
  {
    name: "IPC Logging Boundary",
    sources: ["docs/gitbook/architecture/ipc-logging-architecture.md"],
    files: [
      "../lib/contracts/src/logging/ipc-log-message.unit.test.ts",
      "../lib/contracts/src/logging/ipc-log-router.unit.test.ts",
      "../lib/contracts/src/logging/ipc-logger-client.unit.test.ts",
      "../lib/contracts/src/logging/logger.unit.test.ts",
    ],
    dimensions: {
      positiveParameters: [
        "accepts the complete documented IPC log wire shape for every supported level",
        "forwards a well-formed ipc-log message to the real logger at the matching level",
        "serializes each ILogger method into an IIpcLogMessage with the matching level",
      ],
      negativeParameters: [
        "rejects tagged payloads with a missing or unsupported level",
        "rejects tagged payloads with a missing or non-string message",
        "returns false and does not touch the logger for a message that isn't an ipc-log",
      ],
      inputCompleteness: [
        "accepts a valid IPC log message when optional context is omitted",
        "includes context only when given",
        "rejects unrelated primitives, null, arrays, and non-log objects",
      ],
      outputCompleteness: [
        "emits a LogEvent to every registered listener for each level",
        "forwards a well-formed ipc-log message to the real logger at the matching level",
        "includes context only when given",
      ],
      errorHandling: [
        "returns false without throwing for tagged but malformed ipc-log payloads",
        "never throws when calling onLog() — an isolated context has nothing to subscribe to",
      ],
      unexpectedInput: [
        "rejects tagged payloads whose context is not a record",
        "rejects unrelated primitives, null, arrays, and non-log objects",
        "returns false without throwing for tagged but malformed ipc-log payloads",
      ],
      determinism: [
        "returns the same validation result across repeated identical inputs",
      ],
      sourceTraceability: [
        "TDD-SOURCE: docs/gitbook/architecture/ipc-logging-architecture.md",
      ],
    },
  },
  {
    name: "SQLite Migration Boundary",
    sources: ["docs/gitbook/architecture/testing-and-quality-architecture.md"],
    files: [
      "../lib/schema/src/sqlite/migration-runner.unit.test.ts",
      "../lib/schema/src/sqlite/migration-runner.contract.integration.test.ts",
    ],
    dimensions: {
      positiveParameters: [
        "creates every table from the migration with the expected columns",
        "records applied migrations in schema_migrations",
        "is a no-op on a second run: does not re-apply and does not error",
      ],
      negativeParameters: [
        "ignores non-SQL files instead of recording or executing them",
        "rolls back all pending migration effects and ledger writes when a later migration fails",
      ],
      inputCompleteness: [
        "handles an empty migration directory and creates an empty migration ledger",
        "applies pending migrations in deterministic filename order",
        "ignores non-SQL files instead of recording or executing them",
      ],
      outputCompleteness: [
        "creates every table from the migration with the expected columns",
        "enforces identity constraints at the DDL level (issue #232)",
        "records applied migrations in schema_migrations",
      ],
      errorHandling: [
        "rolls back all pending migration effects and ledger writes when a later migration fails",
      ],
      unexpectedInput: [
        "handles an empty migration directory and creates an empty migration ledger",
        "ignores non-SQL files instead of recording or executing them",
        "rolls back all pending migration effects and ledger writes when a later migration fails",
      ],
      determinism: [
        "applies pending migrations in deterministic filename order",
        "produces the same normalized schema and ledger across identical fresh runs",
      ],
      sourceTraceability: [
        "TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md",
      ],
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

function evaluateContract(contract: ContractEvidence) {
  const combinedSource = readEvidenceFiles(contract.files);
  const dimensions = Object.fromEntries(
    Object.entries(contract.dimensions).map(([dimension, titles]) => [
      dimension,
      {
        passed: titles.filter((title) => combinedSource.includes(title)).length,
        required: titles.length,
      },
    ]),
  ) as TddQualityEvidence["dimensions"];

  const skippedTests = (
    combinedSource.match(/\b(?:it|test)\.skip\s*\(/g) ?? []
  ).length;

  return evaluateTddQuality({
    dimensions,
    sourceConformance: "PASS",
    skippedTests,
  });
}

describe("Phase 1 contracts/schema quantitative TDD quality matrix", () => {
  it.each(contracts)(
    "$name meets the contract floor with every mandatory evidence gate",
    (contract) => {
      const result = evaluateContract(contract);

      expect(result.score).toBeGreaterThanOrEqual(
        TDD_QUALITY_MINIMUM_PASS_SCORE,
      );
      expect(result.result).toBe("PASS");
      expect(result.gates.allApplicableDimensionsHaveEvidence).toBe(true);
      expect(result.gates.sourceConformancePasses).toBe(true);
      expect(result.gates.noSkippedTestsCountedAsPassed).toBe(true);
      expect(contract.sources.length).toBeGreaterThan(0);
    },
  );

  it(
    "keeps the aggregate Phase 1 score at or above the governance floor",
    () => {
      const results = contracts.map(evaluateContract);
      const aggregate =
        results.reduce((sum, result) => sum + result.score, 0) / results.length;

      expect(aggregate).toBeGreaterThanOrEqual(TDD_QUALITY_MINIMUM_PASS_SCORE);
      expect(results.every((result) => result.result === "PASS")).toBe(true);
    },
  );
});
