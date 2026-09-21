import { describe, expect, it } from "vitest";
import { DocuviaError, ErrorCodes } from "@workspace/contracts";
import { SemanticDecisionValidator } from "./semantic-decision-validator.js";
import {
  createSemanticOutcome,
  createSemanticRequest,
} from "./semantic-decision-test-fixtures.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase0-contract.md (P0-02)
// TDD-SOURCE: docs/gitbook/adr/platform/PLAT-011-semantic-decision-feature-provider-boundary.md
const validator = new SemanticDecisionValidator();
const request = createSemanticRequest();
const outcome = createSemanticOutcome(request);
const unavailable = {
  schemaVersion: request.schemaVersion,
  requestId: request.requestId,
  featureSchemaVersion: request.featureSchemaVersion,
  evidence: request.evidence,
  status: "unavailable",
  scores: [],
  unavailableCode: "model-not-installed",
  unavailableReason: "no model",
};

function expectInvalid(value: unknown): void {
  expect(() => validator.validateOutcome(request, value)).toThrow(DocuviaError);
  expect(() => validator.validateOutcome(request, value)).toThrow(
    expect.objectContaining({ code: ErrorCodes.SEMANTIC_INVALID_RESPONSE }),
  );
}

describe("semantic outcome contract", () => {
  it("[happy] preserves all independent raw scores without inventing calibrated or verified facts", () => {
    const value = {
      ...outcome,
      scores: outcome.scores.map((s, i) => ({
        ...s,
        probability: i === 0 ? 0 : 1,
      })),
    };
    const before = structuredClone(value);
    expect(validator.validateOutcome(request, value)).toEqual(before);
    expect(value).toEqual(before);
    expect(validator.validateOutcome(request, value)).not.toBe(value);
    expect(validator.validateOutcome(request, value).scores).not.toBe(
      value.scores,
    );
  });

  it("[happy] accepts calibrated provenance without making a policy decision", () => {
    const value = {
      ...outcome,
      scoreKind: "calibrated",
      calibrationVersion: "calibration:1",
    };
    expect(validator.validateOutcome(request, value)).toEqual(value);
  });

  it.each(["model-not-installed", "unsupported-capability"])(
    "[error-handling] keeps %s distinct from scored success",
    (unavailableCode) => {
      const value = { ...unavailable, unavailableCode };
      expect(validator.validateOutcome(request, value)).toEqual(value);
    },
  );

  it.each([
    ["null", null],
    ["array", []],
    ["missing status", { ...outcome, status: undefined }],
    ["unknown status", { ...outcome, status: "accepted" }],
    ["empty scores", { ...outcome, scores: [] }],
    ["missing score", { ...outcome, scores: outcome.scores.slice(1) }],
    [
      "duplicate score",
      { ...outcome, scores: outcome.scores.map(() => outcome.scores[0]) },
    ],
    [
      "unknown output ID",
      {
        ...outcome,
        scores: outcome.scores.map((s) => ({ ...s, optionId: "invented" })),
      },
    ],
    [
      "out-of-order scores",
      { ...outcome, scores: [...outcome.scores].reverse() },
    ],
    ["non-array scores", { ...outcome, scores: {} }],
    ["null score", { ...outcome, scores: [null, ...outcome.scores.slice(1)] }],
    [
      "score metadata",
      {
        ...outcome,
        scores: outcome.scores.map((s) => ({ ...s, verified: true })),
      },
    ],
    ["missing model", { ...outcome, model: undefined }],
    ["incomplete model", { ...outcome, model: { modelId: "a" } }],
    ["runtime handle", { ...outcome, model: { ...outcome.model, tensor: [] } }],
    [
      "raw with calibration",
      { ...outcome, calibrationVersion: "calibration:1" },
    ],
    ["calibrated without version", { ...outcome, scoreKind: "calibrated" }],
    [
      "calibrated blank version",
      { ...outcome, scoreKind: "calibrated", calibrationVersion: " " },
    ],
    ["unknown score kind", { ...outcome, scoreKind: "cosine" }],
    ["verified promotion", { ...outcome, verified: true }],
    ["policy decision", { ...outcome, decision: "accept" }],
    ["unavailable with scores", { ...unavailable, scores: outcome.scores }],
    ["unavailable with model", { ...unavailable, model: outcome.model }],
    [
      "unavailable with calibration",
      { ...unavailable, calibrationVersion: "c1" },
    ],
    ["unavailable blank reason", { ...unavailable, unavailableReason: " " }],
    [
      "unavailable unknown code",
      { ...unavailable, unavailableCode: "whatever" },
    ],
    [
      "success with unavailable reason",
      { ...outcome, unavailableReason: "no model" },
    ],
    ["mismatched request", { ...outcome, requestId: "other" }],
    ["mismatched schema", { ...outcome, schemaVersion: 2 }],
    [
      "mismatched feature schema",
      { ...outcome, featureSchemaVersion: "other" },
    ],
  ])("[invalid-input] rejects %s", (_name, value) => expectInvalid(value));

  it.each([NaN, Infinity, -Infinity, -0.01, 1.01, "0.8", null, undefined])(
    "[invalid-input] rejects probability %s",
    (probability) => {
      expectInvalid({
        ...outcome,
        scores: outcome.scores.map((s) => ({ ...s, probability })),
      });
    },
  );

  it.each([
    "repoId",
    "worktreeId",
    "projectId",
    "snapshotHash",
    "candidateSetHash",
    "truncated",
  ])(
    "[invalid-input] rejects mismatched evidence %s for both statuses",
    (field) => {
      const evidence = {
        ...request.evidence,
        [field]: field === "truncated" ? true : "other",
      };
      expectInvalid({ ...outcome, evidence });
      expectInvalid({ ...unavailable, evidence });
    },
  );

  it.each(["provider", "modelId", "modelVersion", "artifactHash"])(
    "[invalid-input] rejects blank model %s",
    (field) => {
      expectInvalid({ ...outcome, model: { ...outcome.model, [field]: "" } });
    },
  );

  it("[error-handling] cannot validate a success against an invalid original request", () => {
    expect(() =>
      validator.validateOutcome({ ...request, options: [] }, outcome),
    ).toThrow(
      expect.objectContaining({ code: ErrorCodes.SEMANTIC_INVALID_REQUEST }),
    );
  });
});
