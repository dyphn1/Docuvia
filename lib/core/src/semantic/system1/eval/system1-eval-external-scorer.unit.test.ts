import { describe, expect, it } from "vitest";
import {
  SYSTEM1_EVAL_ACTIONS,
  SYSTEM1_EVAL_SCORER_STATUSES,
} from "./system1-eval-constants.js";
import { decideSystem1Request } from "./system1-eval-policy.js";
import { runSystem1ExternalScorerBatch } from "./system1-eval-external-scorer.js";
import type { System1DatasetRecord } from "../system1-types.js";
import type { System1EvaluationPolicy } from "./system1-eval-types.js";

const VALID_SCORER_SCRIPT = [
  "const fs = require('node:fs');",
  "const rows = fs.readFileSync(0, 'utf8').trim().split('\\n').map(JSON.parse);",
  "for (const state of rows) {",
  "  const scores = Object.fromEntries(state.request.options.map((option) => [option.id, 0.5]));",
  "  process.stdout.write(JSON.stringify({ requestId: state.request.requestId, status: 'ok', scoreKind: 'raw', scores }) + '\\n');",
  "}",
].join("\n");

function stateRecord(requestId: string): System1DatasetRecord {
  return {
    request: {
      schemaVersion: 1,
      requestId,
      featureSchemaVersion: "system1-option-selection/v1",
      evidence: {
        repoId: "github.com/example/repo",
        worktreeId: "revision",
        projectId: "tsconfig.json",
        snapshotHash: "snapshot",
        candidateSetHash: "candidates",
        truncated: false,
      },
      task: "edge-relation",
      language: "typescript",
      relation: "cross-file-call",
      context: { text: "{}" },
      options: [
        {
          id: "candidate-a",
          kind: "candidate",
          text: "",
          attributes: { targetId: "src/a.ts#call", tierARank: 0 },
        },
        { id: "UNKNOWN", kind: "unknown", text: "" },
        { id: "VERIFY_WITH_LSP", kind: "verify", text: "" },
      ],
    },
    ambiguityClasses: [],
    notDetectedClasses: [],
    candidateCount: 1,
    textTruncated: false,
  } as unknown as System1DatasetRecord;
}

function frozenPolicy(): System1EvaluationPolicy {
  return {
    schemaVersion: 1,
    calibrationMethod: "isotonic-pava-v1",
    scorerManifestHash: "a".repeat(64),
    calibrator: {
      method: "isotonic-pava-v1",
      fitted: false,
      observationCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      blocks: [],
    },
    precisionTargets: [],
  };
}

function expectVerifyForNonOk(
  states: readonly System1DatasetRecord[],
  responses: readonly { readonly requestId: string; readonly status: string }[],
): void {
  for (const response of responses) {
    if (response.status === SYSTEM1_EVAL_SCORER_STATUSES.OK) continue;
    const state = states.find(
      (candidate) => candidate.request.requestId === response.requestId,
    );
    expect(state).toBeDefined();
    expect(
      decideSystem1Request(
        state as System1DatasetRecord,
        response as never,
        frozenPolicy(),
        0.99,
      ).action,
    ).toBe(SYSTEM1_EVAL_ACTIONS.VERIFY);
  }
}

const command = process.execPath;
const workingDirectory = process.cwd();

function run(
  states: readonly System1DatasetRecord[],
  script: string,
  batchTimeoutMs = 2_000,
) {
  return runSystem1ExternalScorerBatch(states, {
    command,
    args: ["-e", script],
    batchTimeoutMs,
    workingDirectory,
  });
}

describe("System-1 external JSONL scorer", () => {
  it("accepts valid JSONL responses in request order", async () => {
    const states = [stateRecord("external-1"), stateRecord("external-2")];
    const responses = await run(states, VALID_SCORER_SCRIPT);

    expect(responses).toHaveLength(2);
    expect(responses.map(({ status }) => status)).toEqual([
      SYSTEM1_EVAL_SCORER_STATUSES.OK,
      SYSTEM1_EVAL_SCORER_STATUSES.OK,
    ]);
    expect(responses[0]?.scores).toEqual({
      "candidate-a": 0.5,
      UNKNOWN: 0.5,
      VERIFY_WITH_LSP: 0.5,
    });
  });

  it("returns timeout rows and routes them to VERIFY_WITH_LSP", async () => {
    const states = [stateRecord("external-timeout")];
    const responses = await run(
      states,
      "setTimeout(() => process.stdout.write(''), 1500)",
      300,
    );

    expect(responses[0]?.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.TIMEOUT);
    expectVerifyForNonOk(states, responses);
  });

  it("turns malformed JSONL into batch errors and routes them to VERIFY", async () => {
    const states = [stateRecord("external-malformed")];
    const responses = await run(states, "process.stdout.write('not-json\\n')");

    expect(responses[0]?.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.ERROR);
    expectVerifyForNonOk(states, responses);
  });

  it("marks only the row with a wrong request ID as an error", async () => {
    const states = [
      stateRecord("external-wrong"),
      stateRecord("external-good"),
    ];
    const script = VALID_SCORER_SCRIPT.replace(
      "requestId: state.request.requestId",
      "requestId: state.request.requestId === 'external-wrong' ? 'other' : state.request.requestId",
    );
    const responses = await run(states, script);

    expect(responses.map(({ status }) => status)).toEqual([
      SYSTEM1_EVAL_SCORER_STATUSES.ERROR,
      SYSTEM1_EVAL_SCORER_STATUSES.OK,
    ]);
    expectVerifyForNonOk(states, responses);
  });

  it("turns a response-count mismatch into batch errors", async () => {
    const states = [
      stateRecord("external-count-1"),
      stateRecord("external-count-2"),
    ];
    const responses = await run(
      states,
      VALID_SCORER_SCRIPT.replace(
        "for (const state of rows)",
        "for (const state of rows.slice(0, 1))",
      ),
    );

    expect(responses.map(({ status }) => status)).toEqual([
      SYSTEM1_EVAL_SCORER_STATUSES.ERROR,
      SYSTEM1_EVAL_SCORER_STATUSES.ERROR,
    ]);
    expectVerifyForNonOk(states, responses);
  });

  it("turns a nonzero process exit into errors and routes them to VERIFY", async () => {
    const states = [stateRecord("external-exit")];
    const responses = await run(states, "process.exit(7)");

    expect(responses[0]?.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.ERROR);
    expectVerifyForNonOk(states, responses);
  });
});
