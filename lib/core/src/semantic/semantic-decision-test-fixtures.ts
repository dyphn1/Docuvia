import type {
  SemanticDecisionRequest,
  SemanticDecisionScoredOutcome,
} from "@workspace/contracts";

export function createSemanticRequest(): SemanticDecisionRequest {
  return {
    schemaVersion: 1,
    requestId: "request:call-1",
    featureSchemaVersion: "ts-call-fixture-v1",
    evidence: {
      repoId: "repo:a",
      worktreeId: "worktree:a",
      projectId: "project:a",
      snapshotHash: "dirty-content:1",
      candidateSetHash: "ordered-candidates:1",
      truncated: false,
    },
    task: "edge-relation",
    language: "typescript",
    relation: "cross-file-call",
    context: {
      text: "foo()",
      attributes: { line: 1, dirty: true, hint: null },
    },
    options: [
      { id: "target:a", kind: "candidate", text: "a.ts::foo" },
      { id: "target:b", kind: "candidate", text: "b.ts::foo" },
      { id: "unknown", kind: "unknown", text: "unsupported target" },
      { id: "verify", kind: "verify", text: "authoritative resolver" },
    ],
  };
}

export function createSemanticOutcome(
  request = createSemanticRequest(),
): SemanticDecisionScoredOutcome {
  return {
    schemaVersion: request.schemaVersion,
    requestId: request.requestId,
    featureSchemaVersion: request.featureSchemaVersion,
    evidence: { ...request.evidence },
    status: "scored",
    scores: request.options.map((option) => ({
      optionId: option.id,
      probability: 0.8,
    })),
    model: {
      provider: "fixture",
      modelId: "fixture-model",
      modelVersion: "1",
      artifactHash: "artifact:1",
    },
    scoreKind: "raw",
    calibrationVersion: null,
  };
}
