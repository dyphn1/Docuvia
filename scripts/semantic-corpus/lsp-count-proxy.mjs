#!/usr/bin/env node
/** #506 baseline instrumentation: a transparent stdio proxy in front of the real LSP server that
 *  appends one JSON line per process with request counts by method. Used only on a separate,
 *  untimed instrumented pass so the proxy never perturbs the timed repetitions.
 *  Env: DOCUVIA_BASELINE_REAL_LSP (real binary), DOCUVIA_BASELINE_LSP_COUNT_LOG (append target). */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const real = process.env.DOCUVIA_BASELINE_REAL_LSP;
const log = process.env.DOCUVIA_BASELINE_LSP_COUNT_LOG;
const counts = {};
let buffer = Buffer.alloc(0);

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

const child = spawn(real, process.argv.slice(2), {
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
