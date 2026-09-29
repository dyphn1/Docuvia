/** C-09 paired fixed-hardware baseline (#506): AST-only vs AST+LSP on the same snapshots, full and
 *  incremental, cold (first repetition) and warm (the rest). Usage:
 *    pnpm run eval:semantic:baseline --spec <baseline-spec.json> --repos <dir> --work <dir> --out <file>
 *  One command runs at a time under the memory watchdog; the LSP request counts come from a
 *  separate untimed instrumented pass so the counting proxy never perturbs timed repetitions. */
import { spawn } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { summarizeDurations } from "../../lib/core/src/semantic/collection/semantic-collection-reporting.js";
import { freeMemoryPercent, MemoryFloorError } from "./memory-guard.mjs";
import {
  argsFor,
  machineManifest,
  offlineEnv,
  writeJson,
} from "./run-support.mjs";
import { describeRevision, git, materializeSnapshot } from "./snapshot.mjs";
import { DOCUVIA_CLI } from "./tier-a.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REAL_LSP = path.join(
  ROOT,
  "node_modules/.bin/typescript-language-server",
);
const PROXY = path.join(import.meta.dirname, "lsp-count-proxy.mjs");
const ANALYZE_LOG = ".docuvia/logs/analyze.log";
const GUARD_POLL_MS = 1_000;

interface BaselineSnapshot {
  readonly snapshotId: string;
  readonly stratum: string;
  readonly sourceDir: string;
  readonly revision: string;
  readonly subtree: string | null;
  readonly editFile: string;
  readonly repetitions?: number;
}

interface BaselineSpec {
  readonly baselineVersion: string;
  readonly repetitions: number;
  readonly lspProcesses: number;
  readonly memoryFloorPercent: number;
  readonly heapMb: number;
  readonly snapshots: readonly BaselineSnapshot[];
}

const WORKLOADS = [
  "astFull",
  "lspFullBatch",
  "lspFullTotal",
  "astIncremental",
  "lspIncrementalBatch",
  "lspIncrementalTotal",
] as const;
type Workload = (typeof WORKLOADS)[number];

/** Spawns one command, kills its whole process group if free memory drops below the floor. */
function timedRun(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  floorPercent: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on(
      "data",
      (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-4000)),
    );
    let breach: MemoryFloorError | undefined;
    const guard = setInterval(() => {
      const free = freeMemoryPercent();
      if (free >= floorPercent || breach) return;
      breach = new MemoryFloorError(free, floorPercent);
      process.kill(-child.pid!, "SIGKILL");
    }, GUARD_POLL_MS);
    child.on("exit", (code) => {
      clearInterval(guard);
      const elapsed = performance.now() - started;
      if (breach) reject(breach);
      else if (code !== 0)
        reject(new Error(`${args.join(" ")} exited ${code}: ${stderr}`));
      else resolve(elapsed);
    });
  });
}

type LogEvent = Record<string, unknown> & { ts: string; event: string };

/** Events written by the most recent `--escalate-to-lsp` run (from its last `tierB.start`). */
function lastBatchEvents(dir: string): LogEvent[] {
  const file = path.join(dir, ANALYZE_LOG);
  if (!existsSync(file)) return [];
  const events = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LogEvent);
  const start = events.map((e) => e.event).lastIndexOf("analyze.tierB.start");
  return start === -1 ? [] : events.slice(start);
}

function span(events: LogEvent[], from: string, to: string): number | null {
  const a = events.find((e) => e.event === from);
  const b = events.find((e) => e.event === to);
  return a && b ? Date.parse(b.ts) - Date.parse(a.ts) : null;
}

/** Tier B facts plus the Tier B / Tier C split of the batch command, from analyze's own log. */
function batchFacts(dir: string): Record<string, unknown> {
  const events = lastBatchEvents(dir);
  const summary = events.find((e) => e.event === "analyze.tierB.summary");
  if (!summary) return { summary: "missing" };
  const keys = [
    "filesQueued",
    "filesProcessed",
    "filesFailed",
    "edgesApplied",
    "edgesPruned",
    "degraded",
  ];
  const tierC = events.find((e) => e.event === "analyze.tierC.summary");
  return {
    ...Object.fromEntries(keys.map((k) => [k, summary[k]])),
    tierBLogMs: span(events, "analyze.tierB.start", "analyze.tierB.summary"),
    tierCLogMs: span(events, "analyze.tierC.start", "analyze.tierC.summary"),
    tierCQueued: tierC?.queued ?? 0,
  };
}

function applyEdit(dir: string, file: string, rep: number): void {
  const target = path.join(dir, file);
  appendFileSync(
    target,
    `\nexport function docuviaBaselineProbe${rep}(): number {\n  return ${rep};\n}\n`,
  );
  git(dir, ["add", "--", file]);
  git(dir, ["commit", "-q", "--no-verify", "-m", `baseline edit ${rep}`]);
}

class Runner {
  constructor(
    private readonly spec: BaselineSpec,
    private readonly lspEnv: NodeJS.ProcessEnv,
  ) {}

  analyze(
    dir: string,
    lsp: boolean,
    env: NodeJS.ProcessEnv = this.lspEnv,
  ): Promise<number> {
    const flags = lsp
      ? [
          "--escalate-to-lsp",
          "--fallback-ast",
          `--lsp-processes=${this.spec.lspProcesses}`,
        ]
      : [];
    return timedRun(
      [
        `--max-old-space-size=${this.spec.heapMb}`,
        DOCUVIA_CLI,
        "analyze",
        ...flags,
      ],
      dir,
      env,
      this.spec.memoryFloorPercent,
    );
  }

  /** One paired repetition on a fresh clone of the materialized snapshot. */
  async repetition(
    base: string,
    runDir: string,
    editFile: string,
    rep: number,
    env?: NodeJS.ProcessEnv,
  ) {
    rmSync(runDir, { recursive: true, force: true });
    git(path.dirname(runDir), ["clone", "-q", "--local", base, runDir]);
    const astFull = await this.analyze(runDir, false, env);
    const lspFullBatch = await this.analyze(runDir, true, env);
    const fullTierB = batchFacts(runDir);
    applyEdit(runDir, editFile, rep);
    const astIncremental = await this.analyze(runDir, false, env);
    const lspIncrementalBatch = await this.analyze(runDir, true, env);
    const incrementalTierB = batchFacts(runDir);
    rmSync(runDir, { recursive: true, force: true });
    return {
      durations: {
        astFull,
        lspFullBatch,
        lspFullTotal: astFull + lspFullBatch,
        astIncremental,
        lspIncrementalBatch,
        lspIncrementalTotal: astIncremental + lspIncrementalBatch,
      },
      fullTierB,
      incrementalTierB,
    };
  }
}

function countingEnv(
  workDir: string,
  snapshotId: string,
): { env: NodeJS.ProcessEnv; log: string } {
  const log = path.join(workDir, `${snapshotId}.lsp-counts.jsonl`);
  const wrapper = path.join(workDir, `${snapshotId}.lsp-proxy.sh`);
  rmSync(log, { force: true });
  writeFileSync(
    wrapper,
    `#!/bin/sh\nDOCUVIA_BASELINE_REAL_LSP='${REAL_LSP}' DOCUVIA_BASELINE_LSP_COUNT_LOG='${log}' exec '${process.execPath}' '${PROXY}' "$@"\n`,
  );
  chmodSync(wrapper, 0o755);
  return { env: offlineEnv({ DOCUVIA_LSP_BINARY: wrapper }), log };
}

function readCounts(log: string): {
  processStarts: number;
  requests: Record<string, number>;
} {
  const lines = existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const requests: Record<string, number> = {};
  for (const line of lines)
    for (const [method, n] of Object.entries(
      (JSON.parse(line) as { counts: Record<string, number> }).counts,
    ))
      requests[method] = (requests[method] ?? 0) + n;
  return { processStarts: lines.length, requests };
}

function summarize(reps: { durations: Record<Workload, number> }[]) {
  const pick = (w: Workload, from: number) =>
    reps.slice(from).map((r) => r.durations[w]);
  return Object.fromEntries(
    WORKLOADS.map((w) => [
      w,
      {
        cold: summarizeDurations(pick(w, 0).slice(0, 1)),
        warm: reps.length > 1 ? summarizeDurations(pick(w, 1)) : null,
      },
    ]),
  );
}

async function measureSnapshot(
  spec: BaselineSpec,
  snapshot: BaselineSnapshot,
  reposDir: string,
  workDir: string,
) {
  const sourceDir = path.resolve(reposDir, snapshot.sourceDir);
  const source = describeRevision(sourceDir, snapshot.revision);
  const base = path.join(workDir, `${snapshot.snapshotId}-base`);
  materializeSnapshot(sourceDir, source.revision, snapshot.subtree, base);
  const runner = new Runner(spec, offlineEnv({ DOCUVIA_LSP_BINARY: REAL_LSP }));
  const repetitions = snapshot.repetitions ?? spec.repetitions;
  const reps = [];
  for (let rep = 1; rep <= repetitions; rep++) {
    process.stderr.write(
      `[baseline] ${snapshot.snapshotId} rep ${rep}/${repetitions}\n`,
    );
    reps.push(
      await runner.repetition(
        base,
        path.join(workDir, `${snapshot.snapshotId}-run`),
        snapshot.editFile,
        rep,
      ),
    );
  }
  const counting = countingEnv(workDir, snapshot.snapshotId);
  const instrumented = await runner.repetition(
    base,
    path.join(workDir, `${snapshot.snapshotId}-instrumented`),
    snapshot.editFile,
    0,
    counting.env,
  );
  return {
    snapshotId: snapshot.snapshotId,
    stratum: snapshot.stratum,
    revision: source.revision,
    subtree: snapshot.subtree,
    editFile: snapshot.editFile,
    repetitions,
    summary: summarize(reps),
    tierB: {
      full: reps.map((r) => r.fullTierB),
      incremental: reps.map((r) => r.incrementalTierB),
    },
    instrumented: { ...instrumented, lsp: readCounts(counting.log) },
  };
}

async function main(): Promise<void> {
  const args = argsFor(process.argv.slice(2), [
    "--spec",
    "--repos",
    "--work",
    "--out",
  ]);
  const spec = JSON.parse(readFileSync(args["--spec"], "utf8")) as BaselineSpec;
  const results = [];
  for (const snapshot of spec.snapshots) {
    results.push(
      await measureSnapshot(
        spec,
        snapshot,
        args["--repos"],
        path.resolve(args["--work"]),
      ),
    );
    writeJson(args["--out"], {
      machine: machineManifest(),
      spec,
      results,
      complete: false,
    });
  }
  writeJson(args["--out"], {
    machine: machineManifest(),
    spec,
    definitions: {
      astFull: "docuvia analyze on an empty graph (full ingestion)",
      lspFullBatch:
        "docuvia analyze --escalate-to-lsp --fallback-ast right after astFull (Tier B over every parsed file)",
      lspFullTotal:
        "astFull + lspFullBatch of the same repetition (AST+LSP full build)",
      astIncremental:
        "one committed one-file edit, then docuvia analyze (delta; post-commit hook path)",
      lspIncrementalBatch:
        "docuvia analyze --escalate-to-lsp --fallback-ast after astIncremental (pre-push hook path)",
      lspIncrementalTotal:
        "astIncremental + lspIncrementalBatch of the same repetition",
      cold: "first repetition after materializing the snapshot: fresh processes and graph; OS page cache not flushed",
      warm: "repetitions 2..N: fresh processes and graph, OS page cache warm",
      lspBinary:
        "DOCUVIA_LSP_BINARY points at Docuvia's own typescript-language-server (snapshots have no node_modules)",
      offline:
        "LLM endpoint/key variables are removed from the environment, so Tier C never reaches a network model",
      tierBLogMs:
        "Tier B share of an --escalate-to-lsp command, from analyze.log tierB.start -> tierB.summary timestamps",
    },
    results,
    complete: true,
  });
}

await main();
