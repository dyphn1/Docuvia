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
  it("degrades honestly until the package-owned model is implemented", async () => {
    const provider = new SemanticDecisionProvider();

    await expect(provider.checkAvailability()).resolves.toMatchObject({
      available: false,
    });

    const outcome = await provider.score(request);
    expect(outcome.scores).toEqual([]);
    expect(outcome.unavailableReason).toMatch(/not installed/);
  });

  it("registers through the virtual-contract factory token", () => {
    const factory = new DocuviaFactory();
    registerSemanticDecisionProvider(factory);

    const provider = factory.resolve(TOKENS.SemanticDecisionProvider);
    expect(provider.name).toBe("local-semantic-decision");
  });
});
