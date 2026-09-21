import { describe, expect, it, vi } from "vitest";
import {
  DocuviaFactory,
  ErrorCodes,
  TOKENS,
  type ISemanticDecisionProvider,
  type SemanticDecisionOutcome,
  type SemanticDecisionRequest,
} from "@workspace/contracts";
import { SemanticDecisionValidator } from "./semantic-decision-validator.js";
import {
  createSemanticOutcome,
  createSemanticRequest,
} from "./semantic-decision-test-fixtures.js";

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase0-contract.md (P0-04)
// TDD-SOURCE: docs/gitbook/architecture/virtual-contracts-architecture.md
const request = createSemanticRequest();

function createFactory(provider: ISemanticDecisionProvider): DocuviaFactory {
  const factory = new DocuviaFactory();
  factory.register(
    TOKENS.SemanticDecisionValidator,
    () => new SemanticDecisionValidator(),
  );
  factory.register(TOKENS.SemanticDecisionProvider, () => provider);
  factory.lock();
  return factory;
}

/** Contract-only experimental consumer; no production routing is installed in Phase 0. */
async function replay(
  factory: DocuviaFactory,
): Promise<SemanticDecisionOutcome> {
  const validator = factory.resolve(TOKENS.SemanticDecisionValidator);
  const input = validator.validateRequest(request);
  const output = await factory
    .resolve(TOKENS.SemanticDecisionProvider)
    .score(input);
  return validator.validateOutcome(input, output);
}

describe("semantic boundary provider substitutability", () => {
  it.each(["option-scorer", "pair-classifier"])(
    "[happy] replays %s twice with identical full output and unchanged evidence",
    async (name) => {
      const expected = createSemanticOutcome(request);
      const model = { ...expected.model, provider: name, modelId: name };
      const score = vi.fn(async (_request: SemanticDecisionRequest) => ({
        ...expected,
        model,
      }));
      const provider: ISemanticDecisionProvider = {
        name,
        checkAvailability: vi.fn(async () => ({
          available: true,
          capabilities: [
            {
              task: request.task,
              language: request.language,
              relation: request.relation,
              featureSchemaVersion: request.featureSchemaVersion,
              maxCandidates: 32,
              maxInputBytes: 32768,
            },
          ],
        })),
        score,
      };
      const factory = createFactory(provider);
      const before = structuredClone(request);

      const first = await replay(factory);
      const second = await replay(factory);

      expect(first).toEqual({ ...expected, model });
      expect(second).toEqual(first);
      expect(request).toEqual(before);
      expect(score.mock.calls).toEqual([[request], [request]]);
      expect(score.mock.calls[0][0]).not.toBe(request);
    },
  );

  it("[invalid-input] [error-handling] rejects a replacement provider's corrupt result at the consumer boundary", async () => {
    const provider: ISemanticDecisionProvider = {
      name: "bad-provider",
      checkAvailability: async () => ({ available: true, capabilities: [] }),
      score: async () => ({
        ...createSemanticOutcome(),
        scores: [{ optionId: "invented", probability: 1 }],
      }),
    };
    await expect(replay(createFactory(provider))).rejects.toMatchObject({
      code: ErrorCodes.SEMANTIC_INVALID_RESPONSE,
    });
  });
});
