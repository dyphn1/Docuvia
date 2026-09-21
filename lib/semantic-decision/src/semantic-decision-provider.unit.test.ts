import { describe, expect, it } from "vitest";
import {
  DocuviaFactory,
  SemanticDecisionOptionKinds,
  SemanticDecisionSchemaVersion,
  SemanticDecisionStatuses,
  SemanticDecisionTasks,
  SemanticDecisionUnavailableCodes,
  TOKENS,
  type SemanticDecisionRequest,
} from "@workspace/contracts";
import { SemanticDecisionProvider } from "./semantic-decision-provider.js";
import { registerSemanticDecisionProvider } from "./register.js";

const MODEL_NOT_INSTALLED =
  "semantic decision model is not installed in this foundation slice";

const request: SemanticDecisionRequest = {
  schemaVersion: SemanticDecisionSchemaVersion,
  requestId: "request-1",
  featureSchemaVersion: "phase0-test-v1",
  evidence: {
    repoId: "repo-1",
    worktreeId: "worktree-1",
    projectId: "project-1",
    snapshotHash: "snapshot-1",
    candidateSetHash: "candidate-set-1",
    truncated: false,
  },
  task: SemanticDecisionTasks.EDGE_RELATION,
  language: "typescript",
  relation: "cross-file-call",
  context: { text: "caller imports Foo" },
  options: [
    {
      id: "candidate:foo",
      kind: SemanticDecisionOptionKinds.CANDIDATE,
      text: "src/foo.ts::Foo",
    },
    {
      id: "unknown",
      kind: SemanticDecisionOptionKinds.UNKNOWN,
      text: "no supported target",
    },
    {
      id: "verify",
      kind: SemanticDecisionOptionKinds.VERIFY,
      text: "verify with authoritative resolver",
    },
  ],
};

function expectedUnavailable(input: SemanticDecisionRequest) {
  return {
    status: SemanticDecisionStatuses.UNAVAILABLE,
    scores: [],
    unavailableCode: SemanticDecisionUnavailableCodes.MODEL_NOT_INSTALLED,
    unavailableReason: MODEL_NOT_INSTALLED,
    schemaVersion: input.schemaVersion,
    requestId: input.requestId,
    featureSchemaVersion: input.featureSchemaVersion,
    evidence: input.evidence,
  };
}

describe("SemanticDecisionProvider foundation boundary", () => {
  it("[happy] registers through the virtual-contract factory token", () => {
    const factory = new DocuviaFactory();
    registerSemanticDecisionProvider(factory);

    const provider = factory.resolve(TOKENS.SemanticDecisionProvider);
    expect(provider.name).toBe("local-semantic-decision");
  });

  it("[invalid-input] never invents scores when called before domain validation", async () => {
    const provider = new SemanticDecisionProvider();
    const invalidRequest: SemanticDecisionRequest = { ...request, options: [] };

    await expect(provider.score(invalidRequest)).resolves.toEqual(
      expectedUnavailable(invalidRequest),
    );
  });

  it("[error-handling] reports model unavailability without throwing", async () => {
    const provider = new SemanticDecisionProvider();

    await expect(provider.checkAvailability()).resolves.toEqual({
      available: false,
      reason: MODEL_NOT_INSTALLED,
      capabilities: [],
    });
    await expect(provider.score(request)).resolves.toEqual(
      expectedUnavailable(request),
    );
  });
});
