import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
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
// Scorer entry points must be files inside the containment root, so each test script is written
// into a private sandbox that serves as both root and working directory.
const workingDirectory = realpathSync(
  mkdtempSync(path.join(tmpdir(), "system1-scorer-root-")),
);
const outsideDirectory = realpathSync(
  mkdtempSync(path.join(tmpdir(), "system1-scorer-outside-")),
);
let scriptCounter = 0;

afterAll(() => {
  rmSync(workingDirectory, { recursive: true, force: true });
  rmSync(outsideDirectory, { recursive: true, force: true });
});

function writeScript(script: string, directory = workingDirectory): string {
  const file = path.join(directory, `scorer-${scriptCounter++}.js`);
  writeFileSync(file, script);
  return file;
}

function run(
  states: readonly System1DatasetRecord[],
  script: string,
  batchTimeoutMs = SUBPROCESS_TEST_TIMEOUT_MS,
) {
  return runSystem1ExternalScorerBatch(states, {
    command,
    args: [writeScript(script)],
    batchTimeoutMs,
    workingDirectory,
    containmentRoot: workingDirectory,
  });
}

async function expectNotSpawned(options: {
  command: string;
  args: (marker: string) => string[];
}): Promise<void> {
  const marker = path.join(outsideDirectory, `spawned-${scriptCounter++}`);
  const responses = await runSystem1ExternalScorerBatch(
    [stateRecord("external-rejected")],
    {
      command: options.command,
      args: options.args(marker),
      batchTimeoutMs: SUBPROCESS_TEST_TIMEOUT_MS,
      workingDirectory,
      containmentRoot: workingDirectory,
    },
  );
  expect(responses[0]?.status).toBe(SYSTEM1_EVAL_SCORER_STATUSES.ERROR);
  expect(existsSync(marker)).toBe(false);
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
    await expectNotSpawned({
      command: "/bin/sh",
      args: (marker) => ["-c", `touch '${marker}'`],
    });
  });

  it("[security] rejects inline node code (-e/--eval/-p) without spawning it", async () => {
    for (const flag of ["-e", "--eval", "-p"]) {
      await expectNotSpawned({
        command,
        args: (marker) => [
          flag,
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, "")`,
        ],
      });
    }
  });

  it("[security] rejects a node --require preload ahead of the entry point", async () => {
    await expectNotSpawned({
      command,
      args: (marker) => [
        "--require",
        writeScript(
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, "")`,
          outsideDirectory,
        ),
        writeScript("process.exit(0)"),
      ],
    });
  });

  it("[security] rejects an interpreter script outside the containment root", async () => {
    await expectNotSpawned({
      command,
      args: (marker) => [
        writeScript(
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, "")`,
          outsideDirectory,
        ),
      ],
    });
  });

  // Creating symlinks needs elevated rights on Windows runners.
  it.skipIf(process.platform === "win32")(
    "[security] rejects a symlinked entry point that escapes the containment root",
    async () => {
      await expectNotSpawned({
        command,
        args: (marker) => {
          const target = writeScript(
            `require('node:fs').writeFileSync(${JSON.stringify(marker)}, "")`,
            outsideDirectory,
          );
          const link = path.join(
            workingDirectory,
            `link-${scriptCounter++}.js`,
          );
          symlinkSync(target, link);
          return [link];
        },
      });
    },
  );
});

describe("System-1 external scorer command validation", () => {
  const entryPoint = writeScript("process.exit(0)");
  const base = {
    command,
    args: [path.basename(entryPoint), "--scorer-flag"],
    workingDirectory,
    containmentRoot: workingDirectory,
  };

  it("[happy] canonicalizes a relative entry point inside the root and keeps scorer arguments", () => {
    expect(resolveSystem1ExternalScorerCommand(base)?.args).toEqual([
      entryPoint,
      "--scorer-flag",
    ]);
  });

  it("[happy] resolves a bare allowlisted interpreter through PATH", () => {
    expect(
      resolveSystem1ExternalScorerCommand({ ...base, command: "node" })
        ?.executable,
    ).toMatch(/node(\.exe)?$/i);
  });

  it("[security] strips NODE_OPTIONS from the scorer environment", () => {
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--require /tmp/evil.js";
    try {
      expect(
        resolveSystem1ExternalScorerCommand(base)?.env.NODE_OPTIONS,
      ).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
  });

  it("[security] rejects relative commands, unknown names, inline code, missing entry points and NUL bytes", () => {
    for (const input of [
      { ...base, command: "./node" },
      { ...base, command: "../bin/node" },
      { ...base, command: "sh" },
      { ...base, command: "" },
      { ...base, args: [] },
      { ...base, args: ["-e", "1"] },
      { ...base, command: "python3", args: ["-c", "print(1)"] },
      { ...base, args: ["missing.js"] },
      { ...base, args: [path.basename(entryPoint), "ok\0bad"] },
    ]) {
      expect(resolveSystem1ExternalScorerCommand(input)).toBeNull();
    }
  });

  it("[security] rejects a working directory outside the containment root", () => {
    expect(
      resolveSystem1ExternalScorerCommand({
        ...base,
        workingDirectory: outsideDirectory,
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
