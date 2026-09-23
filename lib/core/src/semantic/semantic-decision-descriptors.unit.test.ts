import { describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "@workspace/contracts";
import { SemanticDecisionValidator } from "./semantic-decision-validator.js";
import {
  createSemanticRequest,
  createSemanticOutcome,
} from "./semantic-decision-test-fixtures.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase0-contract.md (P0-01/P0-02)
const validator = new SemanticDecisionValidator();

function requestCase() {
  const value = createSemanticRequest();
  return {
    value,
    validate: () => validator.validateRequest(value),
    code: ErrorCodes.SEMANTIC_INVALID_REQUEST,
    fields: [
      [value, "requestId"],
      [value.evidence, "repoId"],
      [value.context, "text"],
      [value.context.attributes!, "line"],
      [value.options[0], "kind"],
      [value.options, "0"],
    ] as [object, string][],
    array: value.options,
  };
}

function outcomeCase() {
  const request = createSemanticRequest();
  const value = createSemanticOutcome(request);
  return {
    value,
    validate: () => validator.validateOutcome(request, value),
    code: ErrorCodes.SEMANTIC_INVALID_RESPONSE,
    fields: [
      [value, "requestId"],
      [value.evidence, "repoId"],
      [value.model, "modelId"],
      [value.scores[0], "probability"],
      [value.scores, "0"],
    ] as [object, string][],
    array: value.scores,
  };
}

for (const [name, createCase] of [
  ["request", requestCase],
  ["outcome", outcomeCase],
] as const) {
  describe(`semantic ${name} data descriptors`, () => {
    for (const [index] of createCase().fields.entries()) {
      it(`[invalid-input] rejects non-enumerable field ${index}`, () => {
        const test = createCase();
        const [object, key] = test.fields[index];
        Object.defineProperty(object, key, { enumerable: false });
        expect(test.validate).toThrow(
          expect.objectContaining({ code: test.code }),
        );
      });

      it(`[invalid-input] rejects changing accessor field ${index} without invoking it`, () => {
        const test = createCase();
        const [object, key] = test.fields[index];
        const original = Object.getOwnPropertyDescriptor(object, key)!.value;
        const getter = vi
          .fn()
          .mockReturnValueOnce(original)
          .mockReturnValue(null);
        Object.defineProperty(object, key, { get: getter, enumerable: true });
        expect(test.validate).toThrow(
          expect.objectContaining({ code: test.code }),
        );
        expect(getter).not.toHaveBeenCalled();
      });
    }

    it.each(["toJSON", Symbol.iterator, "extra"])(
      "[invalid-input] rejects custom array property %s without executing it",
      (key) => {
        const test = createCase();
        const hook = vi.fn(() => []);
        Object.defineProperty(test.array, key, { value: hook });
        expect(test.validate).toThrow(
          expect.objectContaining({ code: test.code }),
        );
        expect(hook).not.toHaveBeenCalled();
      },
    );

    it("[happy] accepts frozen data and returns a fresh complete value twice", () => {
      const test = createCase();
      for (const [object] of test.fields) Object.freeze(object);
      Object.freeze(test.array);
      const first = test.validate();
      const second = test.validate();
      expect(first).toEqual(test.value);
      expect(second).toEqual(first);
      expect(first).not.toBe(test.value);
      expect(second).not.toBe(first);
    });
  });
}

it("[boundary] [error-handling] rejects oversized options before touching an element", () => {
  const value = createSemanticRequest();
  const getter = vi.fn(() => {
    throw new Error("must not inspect oversized options");
  });
  Object.defineProperty(value.options, "length", { value: 1_000_000 });
  Object.defineProperty(value.options, "0", { get: getter });
  expect(() => validator.validateRequest(value)).toThrow(
    expect.objectContaining({ code: ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED }),
  );
  expect(getter).not.toHaveBeenCalled();
});
