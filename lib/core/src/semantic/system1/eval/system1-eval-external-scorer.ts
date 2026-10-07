import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  SYSTEM1_EVAL_JSON_LINE_ENDING,
  SYSTEM1_EVAL_SCORER_STATUSES,
  SYSTEM1_EVAL_SCORE_KIND,
  SYSTEM1_EVAL_STDERR_LIMIT_BYTES,
  SYSTEM1_EVAL_STDOUT_LIMIT_BYTES,
} from "./system1-eval-constants.js";
import { validateSystem1ScorerResponse } from "./system1-eval-scorer.js";
import { resolveSystem1ExternalScorerCommand } from "./system1-eval-external-scorer-command.js";
import type { System1DatasetRecord } from "../system1-types.js";
import type { System1ScorerResponse } from "./system1-eval-types.js";

export interface System1ExternalScorerBatchSettings {
  readonly command: string;
  readonly args: readonly string[];
  readonly batchTimeoutMs: number;
  readonly workingDirectory: string;
  /** Directory the working directory and any non-interpreter executable must stay inside. */
  readonly containmentRoot: string;
}

function errorResponse(requestId: string): System1ScorerResponse {
  return {
    requestId,
    status: SYSTEM1_EVAL_SCORER_STATUSES.ERROR,
    scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
    scores: {},
  };
}

function errorResponses(
  states: readonly System1DatasetRecord[],
  status: System1ScorerResponse["status"],
): System1ScorerResponse[] {
  return states.map(({ request }) => ({
    requestId: request.requestId,
    status,
    scoreKind: SYSTEM1_EVAL_SCORE_KIND.RAW,
    scores: {},
  }));
}

function parseExternalResponses(
  stdout: Buffer,
  states: readonly System1DatasetRecord[],
): System1ScorerResponse[] {
  const text = stdout.toString("utf8");
  const lines =
    text.length === 0 ? [] : text.split(SYSTEM1_EVAL_JSON_LINE_ENDING);
  if (lines.at(-1) === "") lines.pop();
  if (lines.some((line) => line.length === 0))
    return errorResponses(states, SYSTEM1_EVAL_SCORER_STATUSES.ERROR);
  let values: unknown[];
  try {
    values = lines.map((line) => JSON.parse(line) as unknown);
  } catch {
    return errorResponses(states, SYSTEM1_EVAL_SCORER_STATUSES.ERROR);
  }
  if (values.length !== states.length)
    return errorResponses(states, SYSTEM1_EVAL_SCORER_STATUSES.ERROR);
  return states.map((state, index) =>
    validateSystem1ScorerResponse(state, values[index]),
  );
}

/** Releases every handle the batch holds on the child (#564): listeners, stdio streams, the
 *  process group, and the event-loop reference. A no-op error listener stays on each stream so a
 *  late EPIPE from a destroyed pipe cannot surface as an unhandled error. */
export function teardownProcess(child: ChildProcessWithoutNullStreams): void {
  const ignore = (): void => undefined;
  child.removeAllListeners();
  child.on("error", ignore);
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.removeAllListeners();
    stream.on("error", ignore);
    stream.destroy();
  }
  if (child.exitCode === null && child.signalCode === null) killProcess(child);
  child.unref();
}

function killProcess(child: ChildProcessWithoutNullStreams): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** Runs one state-only external JSONL scorer batch with bounded time and output. */
export async function runSystem1ExternalScorerBatch(
  states: readonly System1DatasetRecord[],
  settings: System1ExternalScorerBatchSettings,
): Promise<System1ScorerResponse[]> {
  const invocation = resolveSystem1ExternalScorerCommand(settings);
  if (!invocation)
    return errorResponses(states, SYSTEM1_EVAL_SCORER_STATUSES.ERROR);
  return new Promise((resolve) => {
    const child = spawn(invocation.executable, [...invocation.args], {
      cwd: invocation.workingDirectory,
      env: invocation.env,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let settled = false;
    let outputOverflow = false;
    const finish = (responses: System1ScorerResponse[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      teardownProcess(child);
      resolve(responses);
    };
    const timer = setTimeout(() => {
      finish(errorResponses(states, SYSTEM1_EVAL_SCORER_STATUSES.TIMEOUT));
    }, settings.batchTimeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > SYSTEM1_EVAL_STDOUT_LIMIT_BYTES) {
        outputOverflow = true;
        finish(errorResponses(states, SYSTEM1_EVAL_SCORER_STATUSES.ERROR));
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrSize += Math.min(
        chunk.length,
        SYSTEM1_EVAL_STDERR_LIMIT_BYTES - stderrSize,
      );
    });
    child.once("error", () => {
      finish(errorResponses(states, SYSTEM1_EVAL_SCORER_STATUSES.ERROR));
    });
    child.once("close", (code) => {
      if (settled) return;
      if (outputOverflow || code !== 0) {
        finish(errorResponses(states, SYSTEM1_EVAL_SCORER_STATUSES.ERROR));
        return;
      }
      finish(parseExternalResponses(Buffer.concat(stdoutChunks), states));
    });
    const input = states
      .map((state) => JSON.stringify(state))
      .join(SYSTEM1_EVAL_JSON_LINE_ENDING)
      .concat(SYSTEM1_EVAL_JSON_LINE_ENDING);
    child.stdin.on("error", () => {
      if (!settled)
        finish(errorResponses(states, SYSTEM1_EVAL_SCORER_STATUSES.ERROR));
    });
    child.stdin.end(input, "utf8");
    void stderrSize;
  });
}
