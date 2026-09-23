import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DocuviaFactory,
  DocuviaError,
  ErrorCodes,
  type SemanticDecisionCallOptions,
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

// TDD-SOURCE: docs/gitbook/analysis/semantic-decision-phase0-contract.md (P0-03)
// TDD-SOURCE: docs/gitbook/adr/platform/PLAT-011-semantic-decision-feature-provider-boundary.md

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

describe("SemanticDecisionProvider control contract", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("[happy] accepts optional controls without inventing capabilities or retaining evidence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const provider = new SemanticDecisionProvider();
    const controller = new AbortController();
    const options = { deadlineUnixMs: 1001, signal: controller.signal };
    const before = structuredClone(request);

    const first = await provider.score(request, options);
    const second = await provider.score(request, options);

    expect(first).toEqual(expectedUnavailable(request));
    expect(second).toEqual(first);
    expect(first.evidence).not.toBe(request.evidence);
    expect(first.evidence).not.toBe(second.evidence);
    expect(request).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[error-handling] rejects cancellation before expiry even without an installed model", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new SemanticDecisionProvider();
    await expect(
      provider.score(request, { signal: controller.signal, deadlineUnixMs: 0 }),
    ).rejects.toMatchObject({
      name: "DocuviaError",
      code: ErrorCodes.SEMANTIC_CANCELLED,
    });
  });

  it.each([0, 999, 1000])(
    "[boundary] rejects an expired or equal deadline %s",
    async (deadlineUnixMs) => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);
      await expect(
        new SemanticDecisionProvider().score(request, { deadlineUnixMs }),
      ).rejects.toMatchObject({
        name: "DocuviaError",
        code: ErrorCodes.SEMANTIC_DEADLINE_EXCEEDED,
      });
    },
  );

  it.each([
    null,
    [],
    "controls",
    { extra: true },
    { signal: null },
    { signal: { aborted: true } },
    ...[-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1001"].map(
      (deadlineUnixMs) => ({ deadlineUnixMs }),
    ),
  ])("[invalid-input] rejects malformed controls %j", async (value) => {
    const provider = new SemanticDecisionProvider();
    const call = provider.score(request, value as SemanticDecisionCallOptions);
    await expect(call).rejects.toBeInstanceOf(DocuviaError);
    await expect(call).rejects.toMatchObject({
      code: ErrorCodes.SEMANTIC_INVALID_REQUEST,
    });
  });

  it("[happy] resolves independent provider instances and no mutable availability state", async () => {
    const factory = new DocuviaFactory();
    registerSemanticDecisionProvider(factory);
    const first = factory.resolve(TOKENS.SemanticDecisionProvider);
    const second = factory.resolve(TOKENS.SemanticDecisionProvider);
    expect(first).not.toBe(second);
    expect(await first.checkAvailability()).toEqual(
      await second.checkAvailability(),
    );
    expect(await first.score(request)).toEqual(await second.score(request));
  });
});
