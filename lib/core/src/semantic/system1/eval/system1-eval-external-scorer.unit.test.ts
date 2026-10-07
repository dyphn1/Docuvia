import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";
import {
  SYSTEM1_EVAL_ACTIONS,
  SYSTEM1_EVAL_PROTOCOL_VERSION,
  SYSTEM1_EVAL_SCORER_STATUSES,
} from "./system1-eval-constants.js";
import { decideSystem1Request } from "./system1-eval-policy.js";
import {
  runSystem1ExternalScorerBatch,
  teardownProcess,
} from "./system1-eval-external-scorer.js";
import { resolveSystem1ExternalScorerCommand } from "./system1-eval-external-scorer-command.js";
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
    protocolVersion: SYSTEM1_EVAL_PROTOCOL_VERSION,
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
  batchTimeoutMs = SUBPROCESS_TEST_TIMEOUT_MS,
) {
  return runSystem1ExternalScorerBatch(states, {
    command,
    args: ["-e", script],
    batchTimeoutMs,
    workingDirectory,
    containmentRoot: workingDirectory,
  });
}

describe("System-1 external JSONL scorer", () => {
  it("[boundary] accepts ordered responses when the child starts slowly", async () => {
    const states = [
      stateRecord("external-slow-1"),
      stateRecord("external-slow-2"),
    ];
    const script = `setTimeout(() => {\n${VALID_SCORER_SCRIPT}\n}, 2_100);`;
    const responses = await run(states, script);

    expect(responses.map(({ status }) => status)).toEqual([
      SYSTEM1_EVAL_SCORER_STATUSES.OK,
      SYSTEM1_EVAL_SCORER_STATUSES.OK,
    ]);
    expect(responses.map(({ requestId }) => requestId)).toEqual([
      "external-slow-1",
      "external-slow-2",
    ]);
  });

  it("[happy] accepts valid JSONL responses in request order", async () => {
    const states = [stateRecord("external-1"), stateRecord("external-2")];
    const responses = await run(states, VALID_SCORER_SCRIPT);

    expect(responses).toHaveLength(2);
    expect(responses.map(({ status }) => status)).toEqual([
      SYSTEM1_EVAL_SCORER_STATUSES.OK,
      SYSTEM1_EVAL_SCORER_STATUSES.OK,
    ]);
    expect(responses.map(({ requestId }) => requestId)).toEqual([
      "external-1",
      "external-2",
    ]);
    expect(responses[0]?.scores).toEqual({
      "candidate-a": 0.5,
      UNKNOWN: 0.5,
      VERIFY_WITH_LSP: 0.5,
    });
  });

  it("[error-handling] returns timeout rows and routes them to VERIFY_WITH_LSP", async () => {
    const states = [stateRecord("external-timeout")];
    const responses = await run(
      states,
      "setTimeout(() => process.stdout.write(''), 1500)",
      300,
    );

    expect(responses[0]?.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.TIMEOUT);
    expectVerifyForNonOk(states, responses);
  });

  it("[invalid-input] [error-handling] turns malformed JSONL into batch errors and routes them to VERIFY", async () => {
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

  it("[error-handling] turns a nonzero process exit into errors and routes them to VERIFY", async () => {
    const states = [stateRecord("external-exit")];
    const responses = await run(states, "process.exit(7)");

    expect(responses[0]?.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.ERROR);
    expectVerifyForNonOk(states, responses);
  });

  it("[security] rejects a non-allowlisted executable outside the root without spawning it", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "system1-scorer-"));
    const marker = path.join(outside, "spawned");
    try {
      const responses = await runSystem1ExternalScorerBatch(
        [stateRecord("external-shell")],
        {
          command: "/bin/sh",
          args: ["-c", `touch '${marker}'`],
          batchTimeoutMs: SUBPROCESS_TEST_TIMEOUT_MS,
          workingDirectory,
          containmentRoot: workingDirectory,
        },
      );
      expect(responses[0]?.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.ERROR);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("System-1 external scorer command validation", () => {
  const base = {
    command,
    args: ["scorer.js"],
    workingDirectory,
    containmentRoot: workingDirectory,
  };

  it("[happy] accepts an absolute allowlisted interpreter outside the containment root", () => {
    expect(resolveSystem1ExternalScorerCommand(base)?.args).toEqual([
      "scorer.js",
    ]);
  });

  it("[happy] resolves a bare allowlisted interpreter through PATH", () => {
    expect(
      resolveSystem1ExternalScorerCommand({ ...base, command: "node" })
        ?.executable,
    ).toMatch(/node(\.exe)?$/i);
  });

  it("[security] rejects relative paths, unknown bare names and NUL bytes", () => {
    for (const input of [
      { ...base, command: "./node" },
      { ...base, command: "../bin/node" },
      { ...base, command: "sh" },
      { ...base, command: "" },
      { ...base, args: ["ok\0bad"] },
    ]) {
      expect(resolveSystem1ExternalScorerCommand(input)).toBeNull();
    }
  });

  it("[security] rejects a working directory outside the containment root", () => {
    expect(
      resolveSystem1ExternalScorerCommand({
        ...base,
        workingDirectory: path.dirname(workingDirectory),
      }),
    ).toBeNull();
    expect(
      resolveSystem1ExternalScorerCommand({
        ...base,
        workingDirectory: path.join(workingDirectory, "does-not-exist"),
      }),
    ).toBeNull();
  });
});

describe("System-1 external scorer teardown", () => {
  it("[resource] removes listeners, destroys stdio and unrefs the child", () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      pid: undefined;
      exitCode: number;
      signalCode: null;
      unrefCalls: number;
      unref: () => void;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = undefined;
    child.exitCode = 0;
    child.signalCode = null;
    child.unrefCalls = 0;
    child.unref = () => {
      child.unrefCalls++;
    };
    child.on("close", () => undefined);
    child.stdout.on("data", () => undefined);

    teardownProcess(child as unknown as ChildProcessWithoutNullStreams);

    expect(child.listenerCount("close")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      expect(stream.destroyed).toBe(true);
    }
    expect(child.unrefCalls).toBe(1);
  });
});
