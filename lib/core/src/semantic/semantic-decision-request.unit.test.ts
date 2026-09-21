import { describe, expect, it } from "vitest";
import {
  DocuviaError,
  ErrorCodes,
  SemanticDecisionLimits,
} from "@workspace/contracts";
import { SemanticDecisionValidator } from "./semantic-decision-validator.js";
import { createSemanticRequest } from "./semantic-decision-test-fixtures.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase0-contract.md (P0-01)
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
const validator = new SemanticDecisionValidator();
const request = createSemanticRequest();
const unknown = { id: "unknown", kind: "unknown", text: "" } as const;

function expectInvalid(
  value: unknown,
  code = ErrorCodes.SEMANTIC_INVALID_REQUEST as string,
): void {
  expect(() => validator.validateRequest(value)).toThrow(DocuviaError);
  expect(() => validator.validateRequest(value)).toThrow(
    expect.objectContaining({ code }),
  );
}

describe("semantic request contract", () => {
  it("[happy] preserves complete evidence, ordering and caller-owned IDs without mutation", () => {
    const value = {
      ...request,
      options: [{ id: " target ", kind: "candidate", text: "" }, unknown],
    };
    const before = structuredClone(value);
    const result = validator.validateRequest(value);
    expect(result).toEqual(before);
    expect(value).toEqual(before);
    expect(result).not.toBe(value);
    expect(result.evidence).not.toBe(value.evidence);
    expect(result.options).not.toBe(value.options);
  });

  it.each(["edge-relation", "impact-relevance"])(
    "[happy] allows unknown-only %s without inventing a target",
    (task) => {
      const value = {
        ...request,
        task,
        options: [unknown],
        context: { text: "" },
      };
      expect(validator.validateRequest(value)).toEqual(value);
    },
  );

  it("[happy] accepts independent verification options", () => {
    const value = {
      ...request,
      task: "needs-verification",
      options: request.options.slice(2),
    };
    expect(validator.validateRequest(value)).toEqual(value);
  });

  it("[boundary] accepts 32 candidates plus unknown and verify", () => {
    const options = Array.from({ length: 32 }, (_, i) => ({
      id: `c${i}`,
      kind: "candidate",
      text: "",
    }));
    const value = {
      ...request,
      options: [...options, ...request.options.slice(2)],
    };
    expect(validator.validateRequest(value)).toEqual(value);
    expectInvalid(
      {
        ...value,
        options: [
          ...options,
          { id: "overflow", kind: "candidate", text: "" },
          unknown,
        ],
      },
      ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED,
    );
    expectInvalid(
      {
        ...value,
        options: [
          ...value.options,
          { id: "extra", kind: "candidate", text: "" },
        ],
      },
      ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED,
    );
  });

  it("[boundary] measures the complete UTF-8 request including attributes and metadata", () => {
    const value = {
      ...request,
      context: { text: "漢🙂", attributes: { note: "" } },
    };
    const remaining =
      SemanticDecisionLimits.MAX_INPUT_BYTES -
      Buffer.byteLength(JSON.stringify(value));
    value.context.attributes.note = "x".repeat(remaining);
    expect(Buffer.byteLength(JSON.stringify(value))).toBe(
      SemanticDecisionLimits.MAX_INPUT_BYTES,
    );
    expect(validator.validateRequest(value)).toEqual(value);
    value.context.attributes.note += "é";
    expectInvalid(value, ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["array", []],
    ["primitive", "request"],
    ["missing context", { ...request, context: undefined }],
    ["unknown task", { ...request, task: "generate-answer" }],
    ["wrong schema", { ...request, schemaVersion: 2 }],
    ["blank request ID", { ...request, requestId: "  " }],
    ["blank feature version", { ...request, featureSchemaVersion: "" }],
    ["blank language", { ...request, language: "" }],
    ["blank relation", { ...request, relation: "" }],
    ["unknown field", { ...request, policy: "accept" }],
    ["incomplete identity", { ...request, evidence: { repoId: "a" } }],
    [
      "truncated evidence",
      { ...request, evidence: { ...request.evidence, truncated: true } },
    ],
    [
      "unexpected identity field",
      { ...request, evidence: { ...request.evidence, headOnly: true } },
    ],
    ["empty options", { ...request, options: [] }],
    ["non-array options", { ...request, options: {} }],
    ["sparse options", { ...request, options: [unknown, ,] }],
    ["null option", { ...request, options: [null, unknown] }],
    ["blank option ID", { ...request, options: [{ ...unknown, id: " " }] }],
    [
      "duplicate option ID",
      { ...request, options: [unknown, { ...unknown, kind: "candidate" }] },
    ],
    [
      "unknown kind",
      { ...request, options: [{ ...unknown, kind: "generated" }] },
    ],
    ["missing unknown", { ...request, options: request.options.slice(0, 2) }],
    [
      "two unknowns",
      { ...request, options: [unknown, { ...unknown, id: "other" }] },
    ],
    [
      "two verifies",
      {
        ...request,
        options: [
          ...request.options,
          { id: "verify2", kind: "verify", text: "" },
        ],
      },
    ],
    [
      "verification without verify",
      { ...request, task: "needs-verification", options: [unknown] },
    ],
    [
      "verification with candidates",
      { ...request, task: "needs-verification" },
    ],
    ["non-string text", { ...request, context: { text: 1 } }],
    [
      "unknown context field",
      { ...request, context: { text: "", tensor: [] } },
    ],
    [
      "nested attributes",
      { ...request, context: { text: "", attributes: { nested: {} } } },
    ],
    [
      "NaN attribute",
      { ...request, context: { text: "", attributes: { score: NaN } } },
    ],
    [
      "infinite attribute",
      {
        ...request,
        options: [{ ...unknown, attributes: { score: Infinity } }],
      },
    ],
    ["array attributes", { ...request, context: { text: "", attributes: [] } }],
    [
      "undefined attribute",
      { ...request, context: { text: "", attributes: { absent: undefined } } },
    ],
  ])(
    "[invalid-input] [error-handling] rejects %s with a typed error",
    (_name, value) => {
      expectInvalid(value);
    },
  );

  it.each([
    "repoId",
    "worktreeId",
    "projectId",
    "snapshotHash",
    "candidateSetHash",
  ])("[invalid-input] rejects blank evidence %s", (field) => {
    expectInvalid({
      ...request,
      evidence: { ...request.evidence, [field]: " " },
    });
  });
});
