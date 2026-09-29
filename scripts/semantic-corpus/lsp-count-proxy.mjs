#!/usr/bin/env node
/** #506 baseline instrumentation: a transparent stdio proxy in front of the real LSP server that
 *  appends one JSON line per process with request counts by method. Used only on a separate,
 *  untimed instrumented pass so the proxy never perturbs the timed repetitions.
 *  The executable and JSON argument array are passed as the first two proxy arguments so the
 *  LSP's intentionally minimal child environment cannot drop them. The environment variables
 *  DOCUVIA_BASELINE_REAL_LSP[_ARGS] remain a direct-invocation fallback; the count log is
 *  DOCUVIA_BASELINE_LSP_COUNT_LOG. */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const [realArgument, realArgsArgument, logArgument, ...serverArgs] =
  process.argv.slice(2);
const real = realArgument ?? process.env.DOCUVIA_BASELINE_REAL_LSP;
const realArgs = JSON.parse(
  realArgsArgument ?? process.env.DOCUVIA_BASELINE_REAL_LSP_ARGS ?? "[]",
);
const log = logArgument ?? process.env.DOCUVIA_BASELINE_LSP_COUNT_LOG;
const counts = {};
let buffer = Buffer.alloc(0);

if (!real) throw new Error("Missing counting proxy LSP executable");

function consume() {
  for (;;) {
    const header = buffer.indexOf("\r\n\r\n");
    if (header === -1) return;
    const match = /Content-Length:\s*(\d+)/i.exec(
      buffer.subarray(0, header).toString("ascii"),
    );
    const length = match ? Number(match[1]) : 0;
    if (buffer.length < header + 4 + length) return;
    const body = buffer
      .subarray(header + 4, header + 4 + length)
      .toString("utf8");
    buffer = buffer.subarray(header + 4 + length);
    try {
      const message = JSON.parse(body);
      if (message.method && message.id !== undefined)
        counts[message.method] = (counts[message.method] ?? 0) + 1;
    } catch {
      counts["<unparseable>"] = (counts["<unparseable>"] ?? 0) + 1;
    }
  }
}

const child = spawn(real, [...realArgs, ...serverArgs], {
  stdio: ["pipe", "inherit", "inherit"],
});
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  consume();
  child.stdin.write(chunk);
});
process.stdin.on("end", () => child.stdin.end());
child.on("exit", (code, signal) => {
  if (log)
    appendFileSync(log, `${JSON.stringify({ pid: process.pid, counts })}\n`);
  process.exit(code ?? (signal ? 1 : 0));
});
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => child.kill(sig));
