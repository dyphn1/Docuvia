import { describe, expect, it } from "vitest";
import {
  DocuviaFactory,
  SemanticDecisionOptionKinds,
  SemanticDecisionTasks,
  TOKENS,
} from "@workspace/contracts";
import { SemanticDecisionProvider } from "./semantic-decision-provider.js";
import { registerSemanticDecisionProvider } from "./register.js";

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

  it(
    "[invalid-input] never invents a score when the bounded option set is empty",
    async () => {
      const provider = new SemanticDecisionProvider();

      const outcome = await provider.score({
        ...request,
        options: [],
      });

      expect(outcome).toEqual({
        scores: [],
        unavailableReason:
          "semantic decision model is not installed in this foundation slice",
      });
    },
  );

  it(
    "[error-handling] degrades honestly instead of throwing while the package-owned model is unavailable",
    async () => {
      const provider = new SemanticDecisionProvider();

      await expect(provider.checkAvailability()).resolves.toEqual({
        available: false,
        reason:
          "semantic decision model is not installed in this foundation slice",
      });

      await expect(provider.score(request)).resolves.toEqual({
        scores: [],
        unavailableReason:
          "semantic decision model is not installed in this foundation slice",
      });
    },
  );
});
