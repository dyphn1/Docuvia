import { describe, expect, it } from "vitest";
import {
  DocuviaFactory,
  SemanticDecisionOptionKinds,
  SemanticDecisionTasks,
  TOKENS,
} from "@workspace/contracts";
import { SemanticDecisionProvider } from "./semantic-decision-provider.js";
import { registerSemanticDecisionProvider } from "./register.js";

const MODEL_NOT_INSTALLED =
  "semantic decision model is not installed in this foundation slice";

const request = {
  task: SemanticDecisionTasks.EDGE_RELATION,
  context: { text: "caller imports Foo" },
  options: [
    {
      id: "candidate:foo",
      kind: SemanticDecisionOptionKinds.CANDIDATE,
      text: "src/foo.ts::Foo",
    },
    {
      id: "verify",
      kind: SemanticDecisionOptionKinds.VERIFY,
      text: "verify with authoritative resolver",
    },
  ],
} as const;

describe("SemanticDecisionProvider foundation boundary", () => {
  it("[happy] registers through the virtual-contract factory token", () => {
    const factory = new DocuviaFactory();
    registerSemanticDecisionProvider(factory);

    const provider = factory.resolve(TOKENS.SemanticDecisionProvider);
    expect(provider.name).toBe("local-semantic-decision");
  });

  it("[invalid-input] returns no score for an empty option set", async () => {
    const provider = new SemanticDecisionProvider();

    const outcome = await provider.score({ ...request, options: [] });

    expect(outcome).toEqual({
      scores: [],
      unavailableReason: MODEL_NOT_INSTALLED,
    });
  });

  it("[error-handling] reports model unavailability without throwing", async () => {
    const provider = new SemanticDecisionProvider();

    await expect(provider.checkAvailability()).resolves.toEqual({
      available: false,
      reason: MODEL_NOT_INSTALLED,
    });
    await expect(provider.score(request)).resolves.toEqual({
      scores: [],
      unavailableReason: MODEL_NOT_INSTALLED,
    });
  });
});
