import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { GitConstants } from "@workspace/contracts";
import { TestSandbox } from "./sandbox.js";
import { inferObservedTarget } from "./impact-honesty-corpus.phase1.js";
import {
  entryFilesFor,
  parseImpactJson,
  sandboxDbPath,
  seedCompleteTierBCoverage,
} from "./impact-honesty-corpus.phase2.js";
import type { RawImpactRun } from "./impact-honesty-epistemic.phase2.js";
import {
  PHASE3_COVERAGE,
  PHASE3_EPISTEMIC,
  PHASE3_EVERY_TARGET,
  PHASE3_FRESHNESS,
  PHASE3_OPERATION,
  PHASE3_PHASES,
  buildPhase3Evaluation,
  normalizeImpactForOracle,
  type Phase3Checkpoint,
  type Phase3Evaluation,
  type Phase3Observation,
  type Phase3OperationResult,
  type Phase3Phase,
  type Phase3StoreFacts,
  type Phase3TargetGolden,
  type Phase3TargetObservation,
} from "./impact-honesty-transition.phase3.js";

// TDD-SOURCE: issue #508 Phase 3 staleness and graph state-transition robustness
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase3.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase0.md
// TDD-SOURCE: docs/gitbook/analysis/impact-benchmark-honesty-phase2.md
// TDD-SOURCE: issue #193 graph freshness visibility
// TDD-SOURCE: issue #480 SQLite concurrency (C1)
// TDD-SOURCE: docs/gitbook/adr/platform/PLAT-007-tiered-background-knowledge-evolution.md
// TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
// TDD-SOURCE: docs/gitbook/guidelines/phase-based-test-quality-hardening.md

export const PHASE3_ROOT = "src/p3";
const P = PHASE3_ROOT;

/** Every fixture path (contract §2.1). */
export const PHASE3_FILES = {
  GITIGNORE: ".gitignore",
  TARGET: `${P}/core/target.ts`,
  TARGET_MOVED: `${P}/core/target-moved.ts`,
  OTHER: `${P}/core/other.ts`,
  CALLER_A: `${P}/users/caller-a.ts`,
  CALLER_B: `${P}/users/caller-b.ts`,
  CALLER_B_RENAMED: `${P}/users/caller-b-renamed.ts`,
  CALLER_C: `${P}/users/caller-c.ts`,
  CALLER_D: `${P}/users/caller-d.ts`,
  CALLER_E: `${P}/users/caller-e.ts`,
  CALLER_F: `${P}/users/caller-f.ts`,
  CALLER_G: `${P}/users/caller-g.ts`,
  SWITCHER: `${P}/users/switcher.ts`,
  GROW: `${P}/users/grow.ts`,
  SUB: `${P}/users/sub.ts`,
  SUB2: `${P}/users/sub2.ts`,
  LOADER: `${P}/dyn/loader.ts`,
  ALPHA: `${P}/dyn/plugins/alpha.ts`,
  BETA: `${P}/dyn/plugins/beta.ts`,
  GAMMA: `${P}/dyn/plugins/gamma.ts`,
  CTRL_TARGET: `${P}/ctrl/ctrl-target.ts`,
  CTRL_USER: `${P}/ctrl/ctrl-user.ts`,
} as const;
const F = PHASE3_FILES;

/** Observed target symbols (no name contains another, so `findNodeByName`'s LIKE fallback cannot
 *  resolve a removed symbol to a neighbor). */
export const PHASE3_TARGETS = {
  TARGET: "evalP3Target",
  BASE: "EvalP3Base",
  OTHER: "evalP3Other",
  ALPHA: "evalP3Alpha",
  CTRL: "evalP3CtrlTarget",
} as const;
const T = PHASE3_TARGETS;

/** Test-side mirror of the product's `MAX_FILE_SIZE_BYTES` (observed from outside, not imported). */
export const PHASE3_MAX_FILE_SIZE_BYTES = 512_000;
const PHASE3_OVERSIZED_BYTES = PHASE3_MAX_FILE_SIZE_BYTES + 8_000;

/** Product artifacts the harness observes (contract §2.1, §3). */
export const PHASE3_ARTIFACTS = {
  KNOWLEDGE_LOCK: ".git/docuvia-knowledge.lock",
  NO_HOOKS_DIR: ".git/p3-no-hooks",
  ANALYZE_LOG: ".docuvia/logs/analyze.log",
  POST_COMMIT_HOOK_LOG: ".docuvia/logs/post-commit-hook.log",
  META_LAST_INGESTED: "lastIngestedSourceSha",
  META_EVIDENCE_PREFIX: "impact.dynamic-dependencies.v1:",
  STATUS_ROW: "Graph Freshness",
} as const;

export const PHASE3_ANALYZE_EVENTS = {
  HEAD_NOT_DESCENDANT: "analyze.delta.head_not_descendant",
  AUTO_ERROR: "analyze.auto.error",
} as const;

const BOUNDED_PATTERN = "bounded-local-pattern";
const GITIGNORE_BODY = [
  ".claude/",
  ".cursor/",
  ".continue/",
  ".github/",
  ".docuvia/",
  "AGENTS.md",
  ".hermes.md",
];

function lines(...body: string[]): string {
  return [...body, ""].join("\n");
}

function targetSource(revision: string): string {
  return lines(
    `// evalP3 target revision ${revision}`,
    "export function evalP3Target(): string {",
    `  return "evalP3Target-${revision}";`,
    "}",
    "",
    "export class EvalP3Base {}",
  );
}

function callerSource(fnName: string, specifier: string): string {
  return lines(
    `import { evalP3Target } from "${specifier}";`,
    "",
    `export function ${fnName}(): string {`,
    "  return evalP3Target();",
    "}",
  );
}

function subSource(
  className: string,
  specifier: string,
  revision = "1",
): string {
  return lines(
    `import { EvalP3Base } from "${specifier}";`,
    "",
    `// ${className} revision ${revision}`,
    `export class ${className} extends EvalP3Base {}`,
  );
}

function plainFunction(fnName: string): string {
  return lines(
    `export function ${fnName}(): string {`,
    `  return "${fnName}";`,
    "}",
  );
}

const SPEC_TARGET = "../core/target";
const SPEC_TARGET_MOVED = "../core/target-moved";

function switcherSource(mode: "target" | "other" | "local"): string {
  if (mode === "target") return callerSource("evalP3Switch", SPEC_TARGET);
  if (mode === "other") {
    return lines(
      'import { evalP3Other } from "../core/other";',
      "",
      "export function evalP3Switch(): string {",
      "  return evalP3Other();",
      "}",
    );
  }
  return lines(
    "function evalP3SwitchHelper(): string {",
    '  return "evalP3SwitchHelper";',
    "}",
    "",
    "export function evalP3Switch(): string {",
    "  return evalP3SwitchHelper();",
    "}",
  );
}

/** T10: no call, padded past `MAX_FILE_SIZE_BYTES` with deterministic content. */
function oversizedGrowSource(): string {
  const header = plainFunction("evalP3Grow");
  const line = `// evalP3 padding ${"x".repeat(60)}`;
  const count = Math.ceil(PHASE3_OVERSIZED_BYTES / (line.length + 1));
  return header + Array.from({ length: count }, () => line).join("\n") + "\n";
}

/** Fixture tree S0 (contract §2.1). */
export const PHASE3_S0_FILES: Record<string, string> = {
  [F.GITIGNORE]: lines(...GITIGNORE_BODY),
  [F.TARGET]: targetSource("1"),
  [F.OTHER]: plainFunction("evalP3Other"),
  [F.CALLER_A]: callerSource("evalP3CallerA", SPEC_TARGET),
  [F.CALLER_B]: callerSource("evalP3CallerB", SPEC_TARGET),
  [F.SWITCHER]: switcherSource("target"),
  [F.GROW]: callerSource("evalP3Grow", SPEC_TARGET),
  [F.SUB]: subSource("EvalP3Sub", SPEC_TARGET),
  [F.SUB2]: subSource("EvalP3Sub2", SPEC_TARGET),
  [F.LOADER]: lines(
    "export async function evalP3Load(n: string): Promise<unknown> {",
    "  return import(`./plugins/${n}`);",
    "}",
  ),
  [F.ALPHA]: plainFunction("evalP3Alpha"),
  [F.BETA]: plainFunction("evalP3Beta"),
  [F.GAMMA]: plainFunction("evalP3Gamma"),
  [F.CTRL_TARGET]: plainFunction("evalP3CtrlTarget"),
  [F.CTRL_USER]: lines(
    'import { evalP3CtrlTarget } from "./ctrl-target";',
    "",
    "export function evalP3CtrlUse(): string {",
    "  return evalP3CtrlTarget();",
    "}",
  ),
};

// ─── Goldens (contract §2.2): hand-written tree models, intended behavior ─────────────────────

/** The dependency facts of one fixture tree; every golden is derived from it. */
export interface Phase3TreeModel {
  readonly targetFile: string;
  readonly targetCallers: readonly string[];
  readonly baseSubs: readonly string[];
  readonly otherPresent: boolean;
  readonly otherCallers: readonly string[];
  readonly loaderPresent: boolean;
  readonly plugins: readonly string[];
}

const S0_MODEL: Phase3TreeModel = {
  targetFile: F.TARGET,
  targetCallers: [F.CALLER_A, F.CALLER_B, F.SWITCHER, F.GROW],
  baseSubs: [F.SUB, F.SUB2],
  otherPresent: true,
  otherCallers: [],
  loaderPresent: true,
  plugins: [F.ALPHA, F.BETA, F.GAMMA],
};

function without(list: readonly string[], ...removed: string[]): string[] {
  return list.filter((item) => !removed.includes(item));
}

const M1 = {
  ...S0_MODEL,
  targetCallers: [...S0_MODEL.targetCallers, F.CALLER_C],
};
const M4 = {
  ...M1,
  targetCallers: without(M1.targetCallers, F.SWITCHER),
  otherCallers: [F.SWITCHER],
};
const M5 = {
  ...M4,
  targetCallers: [...without(M4.targetCallers, F.CALLER_B), F.CALLER_B_RENAMED],
};
const M6 = { ...M5, targetCallers: without(M5.targetCallers, F.CALLER_A) };
const M7 = { ...M6, targetFile: F.TARGET_MOVED };
const M8 = { ...M7, plugins: without(M7.plugins, F.BETA) };
const M9 = { ...M8, loaderPresent: false };
const M11 = { ...M9, otherPresent: false, otherCallers: [] };
const MF1 = { ...M11, targetCallers: [...M11.targetCallers, F.CALLER_D] };
const MI1 = { ...MF1, targetCallers: [...MF1.targetCallers, F.CALLER_E] };
const MC1 = { ...MI1, targetCallers: [...MI1.targetCallers, F.CALLER_F] };
const M10 = { ...MC1, targetCallers: without(MC1.targetCallers, F.GROW) };

/** Tree model after each transition (T12 rewinds to the T6 tree). */
export const PHASE3_MODELS: Readonly<Record<string, Phase3TreeModel>> = {
  T0: S0_MODEL,
  T1: M1,
  T2: M1,
  T3: M1,
  T4: M4,
  T5: M5,
  T6: M6,
  T7: M7,
  T8: M8,
  T9: M9,
  T11: M11,
  F1: MF1,
  I1: MI1,
  R1: MI1,
  C1: MC1,
  T10: M10,
  T12: M6,
};

function exactOrEmpty(confirmed: readonly string[]) {
  return confirmed.length > 0
    ? PHASE3_EPISTEMIC.EXACT
    : PHASE3_EPISTEMIC.LOWER_BOUND;
}

/** HEAD-truth goldens for every observed target of `model`. */
export function afterTargets(model: Phase3TreeModel): Phase3TargetGolden[] {
  const base = { expectedCandidateFiles: [], expectedEvidence: [] };
  return [
    {
      ...base,
      target: T.TARGET,
      targetFile: model.targetFile,
      expectedConfirmedFiles: model.targetCallers,
      expectedEpistemic: exactOrEmpty(model.targetCallers),
    },
    {
      ...base,
      target: T.BASE,
      targetFile: model.targetFile,
      expectedConfirmedFiles: model.baseSubs,
      expectedEpistemic: exactOrEmpty(model.baseSubs),
    },
    {
      ...base,
      target: T.OTHER,
      targetFile: F.OTHER,
      expectedConfirmedFiles: model.otherCallers,
      expectedEpistemic: exactOrEmpty(model.otherCallers),
      ...(model.otherPresent ? {} : { notFound: true }),
    },
    {
      target: T.ALPHA,
      targetFile: F.ALPHA,
      expectedConfirmedFiles: [],
      expectedCandidateFiles: model.loaderPresent ? [F.LOADER] : [],
      expectedEvidence: model.loaderPresent
        ? [
            {
              sourceFile: F.LOADER,
              status: "bounded",
              reason: BOUNDED_PATTERN,
              candidatePaths: model.plugins,
            },
          ]
        : [],
      expectedEpistemic: PHASE3_EPISTEMIC.LOWER_BOUND,
    },
    {
      ...base,
      target: T.CTRL,
      targetFile: F.CTRL_TARGET,
      expectedConfirmedFiles: [F.CTRL_USER],
      expectedEpistemic: PHASE3_EPISTEMIC.EXACT,
    },
  ];
}

/** R1 observes only the targets its re-parses touch, plus the calibration control. */
const R1_TARGETS: readonly string[] = [T.TARGET, T.BASE, T.CTRL];

function pick(
  targets: readonly Phase3TargetGolden[],
  names?: readonly string[],
): Phase3TargetGolden[] {
  return names
    ? targets.filter((target) => names.includes(target.target))
    : [...targets];
}

/** On a stale graph the previous fresh graph is what is observed; only present symbols. */
function staleTargets(
  model: Phase3TreeModel,
  names?: readonly string[],
): Phase3TargetGolden[] {
  return pick(afterTargets(model), names)
    .filter((target) => !target.notFound)
    .map((target) => ({
      ...target,
      expectedEpistemic: PHASE3_EPISTEMIC.LOWER_BOUND,
    }));
}

interface CheckpointOptions {
  readonly previousFresh?: string;
  readonly oracle?: boolean;
  readonly mustDisappear?: Readonly<Record<string, readonly string[]>>;
  readonly accumulationReference?: string;
  readonly expectedEvents?: readonly string[];
  readonly operation?: Phase3Checkpoint["operation"];
  readonly names?: readonly string[];
}

function afterCheckpoint(
  transition: string,
  model: Phase3TreeModel,
  options: CheckpointOptions = {},
): Phase3Checkpoint {
  return {
    id: `${transition}@${PHASE3_PHASES.AFTER}`,
    transition,
    phase: PHASE3_PHASES.AFTER,
    expectedFreshness: PHASE3_FRESHNESS.FRESH,
    expectedCoverage: PHASE3_COVERAGE.COMPLETE,
    targets: pick(afterTargets(model), options.names),
    ...("operation" in options
      ? options.operation
        ? { operation: options.operation }
        : {}
      : { operation: PHASE3_OPERATION.SUCCESS }),
    ...(options.previousFresh ? { previousFresh: options.previousFresh } : {}),
    ...(options.oracle ? { oracle: true } : {}),
    ...(options.mustDisappear ? { mustDisappear: options.mustDisappear } : {}),
    ...(options.accumulationReference
      ? { accumulationReference: options.accumulationReference }
      : {}),
    ...(options.expectedEvents
      ? { expectedEvents: options.expectedEvents }
      : {}),
  };
}

function staleCheckpoint(
  transition: string,
  phase: Phase3Phase,
  previousModel: Phase3TreeModel,
  previousFresh: string,
  options: Pick<CheckpointOptions, "operation" | "names"> = {},
): Phase3Checkpoint {
  return {
    id: `${transition}@${phase}`,
    transition,
    phase,
    expectedFreshness: PHASE3_FRESHNESS.STALE,
    expectedCoverage: PHASE3_COVERAGE.COMPLETE,
    targets: staleTargets(previousModel, options.names),
    previousFresh,
    ...(options.operation ? { operation: options.operation } : {}),
  };
}

const EVERY = PHASE3_EVERY_TARGET;

/** Commit-then-analyze transitions T2-T9, T11 in order: [id, model, after options]. */
const SIMPLE_TRANSITIONS: ReadonlyArray<
  [string, Phase3TreeModel, CheckpointOptions]
> = [
  ["T2", M1, { oracle: true }],
  ["T3", M1, {}],
  ["T4", M4, { oracle: true, mustDisappear: { [T.TARGET]: [F.SWITCHER] } }],
  ["T5", M5, { mustDisappear: { [EVERY]: [F.CALLER_B] } }],
  ["T6", M6, { oracle: true, mustDisappear: { [EVERY]: [F.CALLER_A] } }],
  ["T7", M7, { oracle: true, mustDisappear: { [EVERY]: [F.TARGET] } }],
  ["T8", M8, { mustDisappear: { [EVERY]: [F.BETA] } }],
  ["T9", M9, { mustDisappear: { [EVERY]: [F.LOADER] } }],
  ["T11", M11, { oracle: true }],
];

/** R1 step ids in execution order (contract §2.2): (a) no-op twice, (b) empty commit, (c) 3 cycles. */
export const PHASE3_R1_CYCLES = 3;
function r1Steps(): Array<{ id: string; commits: boolean }> {
  const steps = [
    { id: "R1a1", commits: false },
    { id: "R1a2", commits: false },
    { id: "R1b", commits: true },
  ];
  for (let cycle = 1; cycle <= PHASE3_R1_CYCLES; cycle++) {
    steps.push(
      { id: `R1c${cycle}e`, commits: true },
      { id: `R1c${cycle}r`, commits: true },
    );
  }
  return steps;
}
export const PHASE3_R1_STEPS = r1Steps();

/** Every checkpoint in execution order (contract §2.2). */
export function buildPhase3Checkpoints(): Phase3Checkpoint[] {
  const checkpoints: Phase3Checkpoint[] = [
    afterCheckpoint("T0", S0_MODEL, { oracle: true }),
    staleCheckpoint("T1", PHASE3_PHASES.BEFORE, S0_MODEL, "T0@after"),
    {
      id: `T1@${PHASE3_PHASES.AFTER_TIER_A}`,
      transition: "T1",
      phase: PHASE3_PHASES.AFTER_TIER_A,
      expectedFreshness: PHASE3_FRESHNESS.FRESH,
      expectedCoverage: PHASE3_COVERAGE.PARTIAL,
      targets: afterTargets(M1).map((target) => ({
        ...target,
        expectedEpistemic: PHASE3_EPISTEMIC.LOWER_BOUND,
      })),
      previousFresh: "T0@after",
      operation: PHASE3_OPERATION.SUCCESS,
    },
    afterCheckpoint("T1", M1, {
      previousFresh: "T0@after",
      oracle: true,
      operation: undefined,
    }),
  ];
  let previous: { id: string; model: Phase3TreeModel } = {
    id: "T1@after",
    model: M1,
  };
  for (const [id, model, options] of SIMPLE_TRANSITIONS) {
    checkpoints.push(
      staleCheckpoint(id, PHASE3_PHASES.BEFORE, previous.model, previous.id),
      afterCheckpoint(id, model, { ...options, previousFresh: previous.id }),
    );
    previous = { id: `${id}@after`, model };
  }
  checkpoints.push(
    staleCheckpoint("F1", PHASE3_PHASES.FAILED, M11, previous.id, {
      operation: PHASE3_OPERATION.FAILURE,
    }),
    afterCheckpoint("F1", MF1, { previousFresh: previous.id }),
    staleCheckpoint("I1", PHASE3_PHASES.INFLIGHT, MF1, "F1@after"),
    afterCheckpoint("I1", MI1, { previousFresh: "F1@after", oracle: true }),
  );
  previous = { id: "I1@after", model: MI1 };
  for (const step of PHASE3_R1_STEPS) {
    if (step.commits) {
      checkpoints.push(
        staleCheckpoint(step.id, PHASE3_PHASES.BEFORE, MI1, previous.id, {
          names: R1_TARGETS,
        }),
      );
    }
    checkpoints.push(
      afterCheckpoint(step.id, MI1, {
        previousFresh: previous.id,
        accumulationReference: "I1@after",
        names: R1_TARGETS,
      }),
    );
    previous = { id: `${step.id}@after`, model: MI1 };
  }
  checkpoints.push(
    staleCheckpoint("C1", PHASE3_PHASES.BEFORE, MI1, previous.id),
    afterCheckpoint("C1", MC1, { previousFresh: previous.id, oracle: true }),
    staleCheckpoint("T10", PHASE3_PHASES.BEFORE, MC1, "C1@after"),
    afterCheckpoint("T10", M10, {
      previousFresh: "C1@after",
      oracle: true,
      mustDisappear: { [T.TARGET]: [F.GROW] },
    }),
    staleCheckpoint("T12", PHASE3_PHASES.BEFORE, M10, "T10@after"),
    afterCheckpoint("T12", M6, {
      previousFresh: "T10@after",
      oracle: true,
      mustDisappear: {
        [EVERY]: [F.TARGET_MOVED, F.CALLER_D, F.CALLER_E, F.CALLER_F],
      },
      expectedEvents: [PHASE3_ANALYZE_EVENTS.HEAD_NOT_DESCENDANT],
    }),
  );
  return checkpoints;
}

export const PHASE3_CHECKPOINTS: readonly Phase3Checkpoint[] =
  buildPhase3Checkpoints();

// ─── Real CLI runner ────────────────────────────────────────────────────────────────────────────

const PINNED_EPOCH_MS = Date.UTC(2026, 0, 1);
const PINNED_IDENTITY = {
  GIT_AUTHOR_NAME: "Phase3 Eval",
  GIT_AUTHOR_EMAIL: "phase3@example.com",
  GIT_COMMITTER_NAME: "Phase3 Eval",
  GIT_COMMITTER_EMAIL: "phase3@example.com",
} as const;

/** Real `docuvia impact` through the compiled CLI; never throws. Human mode leaves `json` null. */
export async function runImpactRawDist(
  sandbox: TestSandbox,
  target: string,
  human = false,
): Promise<RawImpactRun> {
  const args = human ? ["impact", target] : ["impact", target, "--format=json"];
  const run = await sandbox.runDistCli(args, { reject: false });
  const exitCode = run.exitCode ?? 1;
  const stdout = String(run.stdout ?? "");
  const stderr = String(run.stderr ?? "");
  const parsed =
    !human && exitCode === 0
      ? parseImpactJson(stdout)
      : { json: null, parseError: false };
  return { exitCode, stdout, stderr, ...parsed };
}

/** Parses the human `status` `Graph Freshness` row (there is no `status --format=json`). */
export async function runStatusFreshness(
  sandbox: TestSandbox,
): Promise<string | null> {
  const run = await sandbox.runDistCli(["status"], { reject: false });
  const row = `${String(run.stdout ?? "")}\n${String(run.stderr ?? "")}`
    .split(/\r?\n/)
    .find((line) => line.includes(PHASE3_ARTIFACTS.STATUS_ROW));
  if (!row) return null;
  for (const state of ["stale", "fresh", "unknown"]) {
    if (row.includes(state)) return state;
  }
  return null;
}

async function readText(path: string): Promise<string> {
  return existsSync(path) ? readFile(path, "utf8") : "";
}

function eventNames(logText: string): string[] {
  return logText
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => String((JSON.parse(line) as { event?: unknown }).event));
}

/** Real `docuvia analyze`, capturing exit code and the analyze log events this run appended. */
export async function runAnalyze(
  sandbox: TestSandbox,
  label: string,
): Promise<Phase3OperationResult> {
  const logPath = join(sandbox.dir, PHASE3_ARTIFACTS.ANALYZE_LOG);
  const before = (await readText(logPath)).length;
  const run = await sandbox.runDistCli(["analyze"], { reject: false });
  const appended = (await readText(logPath)).slice(before);
  return { label, exitCode: run.exitCode ?? 1, events: eventNames(appended) };
}

/** Concurrent-writer artifact (a filesystem lock file, not a DB edit). */
export async function holdKnowledgeLock(sandbox: TestSandbox): Promise<void> {
  await writeFile(join(sandbox.dir, PHASE3_ARTIFACTS.KNOWLEDGE_LOCK), "");
}

export async function releaseKnowledgeLock(
  sandbox: TestSandbox,
): Promise<void> {
  await rm(join(sandbox.dir, PHASE3_ARTIFACTS.KNOWLEDGE_LOCK), { force: true });
}

async function writeRelative(
  sandbox: TestSandbox,
  path: string,
  content: string,
) {
  const full = join(sandbox.dir, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

async function removeRelative(sandbox: TestSandbox, path: string) {
  await rm(join(sandbox.dir, path), { force: true });
}

/** Hooks off, pinned date and identity, stages only `src/p3` (and `.gitignore` when asked). */
export async function commitAt(
  sandbox: TestSandbox,
  index: number,
  message: string,
  options: { allowEmpty?: boolean; includeGitignore?: boolean } = {},
): Promise<string> {
  await sandbox.runGit(["add", "-A", "--", PHASE3_ROOT]);
  if (options.includeGitignore)
    await sandbox.runGit(["add", "--", F.GITIGNORE]);
  const date = new Date(PINNED_EPOCH_MS + index * 1000).toISOString();
  const noHooks = join(sandbox.dir, PHASE3_ARTIFACTS.NO_HOOKS_DIR);
  const { execa } = await import("execa");
  await execa(
    "git",
    [
      "-c",
      `core.hooksPath=${noHooks}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      ...(options.allowEmpty ? ["--allow-empty"] : []),
      "-m",
      message,
    ],
    {
      cwd: sandbox.dir,
      env: {
        ...PINNED_IDENTITY,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    },
  );
  return headSha(sandbox);
}

async function headSha(sandbox: TestSandbox): Promise<string> {
  return (await sandbox.runGit(["rev-parse", "HEAD"])).stdout.trim();
}

/** `git ls-files` at HEAD minus files over `MAX_FILE_SIZE_BYTES` (contract §3). */
async function headTree(sandbox: TestSandbox): Promise<string[]> {
  const listed = (await sandbox.runGit(["ls-files"])).stdout
    .split(/\r?\n/)
    .filter((path) => path.length > 0);
  return listed
    .filter(
      (path) =>
        statSync(join(sandbox.dir, path)).size <= PHASE3_MAX_FILE_SIZE_BYTES,
    )
    .sort();
}

function parsePaths(raw: string | null): string[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function parseCallResolutionPaths(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const parsed = JSON.parse(raw) as { byFile?: unknown };
  if (
    typeof parsed.byFile !== "object" ||
    parsed.byFile === null ||
    Array.isArray(parsed.byFile)
  ) {
    return [];
  }
  return Object.keys(parsed.byFile as Record<string, unknown>);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function count(db: Database.Database, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  ).c;
}

function evidenceRecords(
  db: Database.Database,
): Array<Record<string, unknown>> {
  const rows = db
    .prepare("SELECT value FROM docuvia_meta WHERE key LIKE ?")
    .all(`${PHASE3_ARTIFACTS.META_EVIDENCE_PREFIX}%`) as Array<{
    value: string;
  }>;
  return rows.flatMap((row) => {
    try {
      const parsed = JSON.parse(row.value) as unknown;
      return Array.isArray(parsed)
        ? (parsed as Array<Record<string, unknown>>)
        : [];
    } catch {
      return [];
    }
  });
}

/** Read-only store facts (contract §3). Observation, never repair. */
export function readStoreFacts(
  dbPath: string,
  tree: readonly string[],
): Phase3StoreFacts {
  const db = new Database(dbPath, { readonly: true });
  try {
    const nodePaths = (
      db.prepare("SELECT DISTINCT path_patterns FROM l2_nodes").all() as Array<{
        path_patterns: string | null;
      }>
    ).flatMap((row) => parsePaths(row.path_patterns));
    const callSitePaths = (
      db
        .prepare("SELECT DISTINCT file_path FROM ast_call_sites")
        .all() as Array<{
        file_path: string;
      }>
    ).map((row) => row.file_path);
    const projectFilePaths = (
      db.prepare("SELECT file_path FROM project_files").all() as Array<{
        file_path: string;
      }>
    ).map((row) => row.file_path);
    const evidence = evidenceRecords(db);
    const callResolution = db
      .prepare("SELECT value FROM docuvia_meta WHERE key = ?")
      .get(GitConstants.META_KEY_CALL_RESOLUTION_STATS) as
      { value: string } | undefined;
    const dangling = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM node_links WHERE source_node_id NOT IN (SELECT id FROM l2_nodes) OR target_node_id NOT IN (SELECT id FROM l2_nodes)",
        )
        .get() as { c: number }
    ).c;
    return {
      counts: {
        l2Nodes: count(db, "l2_nodes"),
        nodeLinks: count(db, "node_links"),
        callSites: count(db, "ast_call_sites"),
        projectFiles: count(db, "project_files"),
        evidenceRecords: evidence.length,
      },
      dangling,
      nodePaths: sortedUnique(nodePaths),
      callSitePaths: sortedUnique(callSitePaths),
      projectFilePaths: sortedUnique(projectFilePaths),
      evidencePaths: sortedUnique(
        evidence.flatMap((record) => [
          String(record.sourceFile),
          ...(Array.isArray(record.candidatePaths)
            ? record.candidatePaths.map(String)
            : []),
        ]),
      ),
      callResolutionPaths: sortedUnique(
        parseCallResolutionPaths(callResolution?.value),
      ),
      headTree: [...tree],
    };
  } finally {
    db.close();
  }
}

function readMetaSha(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare("SELECT value FROM docuvia_meta WHERE key = ?")
      .get(PHASE3_ARTIFACTS.META_LAST_INGESTED) as
      { value: string } | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

function blastRadiusNames(run: RawImpactRun): string[] {
  const entries = run.json?.blastRadius;
  return Array.isArray(entries)
    ? entries.map((entry) => String((entry as { name: unknown }).name))
    : [];
}

function identityAndEntries(
  dbPath: string,
  target: string,
  run: RawImpactRun,
): Pick<Phase3TargetObservation, "targetIdentity" | "entryFiles"> {
  if (run.json === null || !existsSync(dbPath)) {
    return { targetIdentity: null, entryFiles: {} };
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    let targetIdentity: Phase3TargetObservation["targetIdentity"] = null;
    try {
      targetIdentity = inferObservedTarget(
        db,
        target,
        run.json as unknown as Parameters<typeof inferObservedTarget>[2],
      );
    } catch {
      targetIdentity = null;
    }
    return {
      targetIdentity,
      entryFiles: entryFilesFor(db, blastRadiusNames(run)),
    };
  } finally {
    db.close();
  }
}

/** JSON for every target (plus human mode for the first) and the status row, concurrently. */
async function observeTargets(
  sandbox: TestSandbox,
  targets: readonly string[],
): Promise<{
  targets: Phase3TargetObservation[];
  statusFreshness: string | null;
}> {
  const [runs, human, statusFreshness] = await Promise.all([
    Promise.all(targets.map((target) => runImpactRawDist(sandbox, target))),
    runImpactRawDist(sandbox, targets[0], true),
    runStatusFreshness(sandbox),
  ]);
  const dbPath = sandboxDbPath(sandbox);
  return {
    statusFreshness,
    targets: targets.map((target, index) => ({
      target,
      run: runs[index],
      ...(index === 0 ? { human } : {}),
      ...identityAndEntries(dbPath, target, runs[index]),
    })),
  };
}

/** Fresh sandbox with the same tracked tree, `init` + seed, normalized JSON per target (S8). */
async function buildOracle(
  distCliPath: string,
  source: TestSandbox,
  targets: readonly string[],
): Promise<Record<string, string>> {
  const tracked = (await source.runGit(["ls-files"])).stdout
    .split(/\r?\n/)
    .filter((path) => path.length > 0);
  const files: Record<string, string> = {};
  for (const path of tracked)
    files[path] = await readFile(join(source.dir, path), "utf8");
  const oracle = new TestSandbox(distCliPath);
  try {
    await oracle.setup({ initGit: true, files });
    await commitAt(oracle, 0, "phase3-oracle", { includeGitignore: true });
    const init = await oracle.runDistCli(["init"], { reject: false });
    if (init.exitCode !== 0)
      throw new Error(`Phase 3 oracle init failed: ${String(init.stderr)}`);
    await seedCompleteTierBCoverage(oracle);
    const runs = await Promise.all(
      targets.map((target) => runImpactRawDist(oracle, target)),
    );
    return Object.fromEntries(
      targets.map((target, index) => [
        target,
        normalizeImpactForOracle(runs[index].json),
      ]),
    );
  } finally {
    await oracle.teardown();
  }
}

/** O1 (observation only, Q1 = HEAD-sha freshness): an uncommitted dependent. */
export interface Phase3DirtyTreeObservation {
  readonly statusFreshness: string | null;
  readonly target: Phase3TargetObservation;
}

export interface Phase3CorpusRun {
  readonly checkpoints: readonly Phase3Checkpoint[];
  readonly observations: Phase3Observation[];
  readonly evaluation: Phase3Evaluation;
  readonly dirtyTree: Phase3DirtyTreeObservation;
  /** C1's concurrent `analyze` exit codes (recorded, not gated; #480). */
  readonly concurrentExitCodes: number[];
  /** Three concurrent T0 read passes: target -> raw JSON stdout (must equal the sequential one). */
  readonly concurrentReads: Array<Record<string, string>>;
  /** Hazard H1: a post-commit hook must never have run. */
  readonly postCommitHookLogExists: boolean;
}

/** One complete transition run in a fresh sandbox (contract §2.2 order). */
class Phase3Runner {
  private commitIndex = 0;
  readonly observations: Phase3Observation[] = [];
  private readonly checkpoints = new Map(
    PHASE3_CHECKPOINTS.map((checkpoint) => [checkpoint.id, checkpoint]),
  );

  constructor(
    readonly sandbox: TestSandbox,
    private readonly distCliPath: string,
  ) {}

  async commit(
    message: string,
    options: { allowEmpty?: boolean } = {},
  ): Promise<string> {
    this.commitIndex += 1;
    return commitAt(this.sandbox, this.commitIndex, message, options);
  }

  write(path: string, content: string) {
    return writeRelative(this.sandbox, path, content);
  }

  remove(path: string) {
    return removeRelative(this.sandbox, path);
  }

  async gitMv(from: string, to: string) {
    await this.sandbox.runGit(["mv", from, to]);
  }

  metaSha(): string | null {
    return readMetaSha(sandboxDbPath(this.sandbox));
  }

  /** Successful analyze plus the §3.3 coverage seed (skipped when the checkpoint is afterTierA). */
  async analyze(label: string, seed = true): Promise<Phase3OperationResult> {
    const operation = await runAnalyze(this.sandbox, label);
    if (operation.exitCode === 0 && seed)
      await seedCompleteTierBCoverage(this.sandbox);
    return operation;
  }

  async observe(
    id: string,
    extra: Pick<
      Phase3Observation,
      "operation" | "metaShaBeforeOperation" | "ungatedOperations"
    > = {},
  ): Promise<void> {
    const checkpoint = this.checkpoints.get(id);
    if (!checkpoint) throw new Error(`Phase 3: no checkpoint ${id}`);
    const names = checkpoint.targets.map((target) => target.target);
    const { targets, statusFreshness } = await observeTargets(
      this.sandbox,
      names,
    );
    const tree = await headTree(this.sandbox);
    const oracle = checkpoint.oracle
      ? await buildOracle(this.distCliPath, this.sandbox, names)
      : undefined;
    this.observations.push({
      checkpointId: id,
      headSha: await headSha(this.sandbox),
      metaSha: this.metaSha(),
      statusFreshness,
      targets,
      facts: readStoreFacts(sandboxDbPath(this.sandbox), tree),
      ...extra,
      ...(oracle ? { oracle } : {}),
    });
  }

  /** Commit, observe `before`, analyze, observe `after`. */
  async simpleTransition(id: string, mutate: () => Promise<void>) {
    await mutate();
    await this.commit(`phase3 ${id}`);
    await this.observe(`${id}@before`);
    const operation = await this.analyze(id);
    await this.observe(`${id}@after`, { operation });
  }
}

/** `[stress]`: three concurrent read passes over T0, raw JSON stdout per target. */
async function concurrentReads(
  sandbox: TestSandbox,
): Promise<Array<Record<string, string>>> {
  const names = PHASE3_CHECKPOINTS[0].targets.map((target) => target.target);
  const passes = await Promise.all(
    [0, 1, 2].map(() =>
      Promise.all(names.map((target) => runImpactRawDist(sandbox, target))),
    ),
  );
  return passes.map((runs) =>
    Object.fromEntries(
      names.map((target, index) => [target, runs[index].stdout]),
    ),
  );
}

async function runBaseline(
  runner: Phase3Runner,
): Promise<Array<Record<string, string>>> {
  await commitAt(runner.sandbox, 0, "phase3 S0", { includeGitignore: true });
  const init = await runner.sandbox.runDistCli(["init"], { reject: false });
  await seedCompleteTierBCoverage(runner.sandbox);
  await runner.observe("T0@after", {
    operation: { label: "init", exitCode: init.exitCode ?? 1, events: [] },
  });
  const reads = await concurrentReads(runner.sandbox);

  await runner.write(F.CALLER_C, callerSource("evalP3CallerC", SPEC_TARGET));
  await runner.commit("phase3 T1");
  await runner.observe("T1@before");
  const t1 = await runner.analyze("T1", false);
  await runner.observe("T1@afterTierA", { operation: t1 });
  await seedCompleteTierBCoverage(runner.sandbox);
  await runner.observe("T1@after");
  return reads;
}

async function runEdgeTransitions(runner: Phase3Runner): Promise<string> {
  await runner.simpleTransition("T2", () =>
    runner.write(F.TARGET, targetSource("2")),
  );
  await runner.simpleTransition("T3", async () => {
    await runner.write(F.TARGET, targetSource("3"));
    await runner.write(F.SUB2, subSource("EvalP3Sub2", SPEC_TARGET, "2"));
  });
  await runner.simpleTransition("T4", () =>
    runner.write(F.SWITCHER, switcherSource("other")),
  );
  await runner.simpleTransition("T5", () =>
    runner.gitMv(F.CALLER_B, F.CALLER_B_RENAMED),
  );
  await runner.simpleTransition("T6", () => runner.remove(F.CALLER_A));
  const t6Sha = await headSha(runner.sandbox);
  await runner.simpleTransition("T7", async () => {
    await runner.gitMv(F.TARGET, F.TARGET_MOVED);
    await runner.write(
      F.CALLER_B_RENAMED,
      callerSource("evalP3CallerB", SPEC_TARGET_MOVED),
    );
    await runner.write(
      F.CALLER_C,
      callerSource("evalP3CallerC", SPEC_TARGET_MOVED),
    );
    await runner.write(F.GROW, callerSource("evalP3Grow", SPEC_TARGET_MOVED));
    await runner.write(F.SUB, subSource("EvalP3Sub", SPEC_TARGET_MOVED));
    await runner.write(F.SUB2, subSource("EvalP3Sub2", SPEC_TARGET_MOVED, "2"));
  });
  await runner.simpleTransition("T8", () => runner.remove(F.BETA));
  await runner.simpleTransition("T9", () => runner.remove(F.LOADER));
  await runner.simpleTransition("T11", async () => {
    await runner.write(F.OTHER, plainFunction("evalP3Remaining"));
    await runner.write(F.SWITCHER, switcherSource("local"));
  });
  return t6Sha;
}

async function runFailureAndInflight(runner: Phase3Runner): Promise<void> {
  const { sandbox } = runner;
  await holdKnowledgeLock(sandbox);
  await runner.write(
    F.CALLER_D,
    callerSource("evalP3CallerD", SPEC_TARGET_MOVED),
  );
  await runner.commit("phase3 F1");
  const beforeFailure = runner.metaSha();
  const failed = await runner.analyze("F1-locked");
  await runner.observe("F1@failed", {
    operation: failed,
    metaShaBeforeOperation: beforeFailure,
  });
  await releaseKnowledgeLock(sandbox);
  const f1 = await runner.analyze("F1");
  await runner.observe("F1@after", { operation: f1 });

  await holdKnowledgeLock(sandbox);
  await runner.write(
    F.CALLER_E,
    callerSource("evalP3CallerE", SPEC_TARGET_MOVED),
  );
  await runner.commit("phase3 I1");
  const background = runAnalyze(sandbox, "I1-background");
  await runner.observe("I1@inflight");
  await releaseKnowledgeLock(sandbox);
  const backgroundResult = await background;
  const followUp = await runner.analyze("I1");
  await runner.observe("I1@after", {
    operation: followUp,
    ungatedOperations: [backgroundResult],
  });
}

async function runAccumulation(runner: Phase3Runner): Promise<void> {
  for (const step of PHASE3_R1_STEPS) {
    if (step.id === "R1b") {
      await runner.commit("phase3 R1b", { allowEmpty: true });
    } else if (step.commits) {
      const edit = step.id.endsWith("e");
      await runner.write(
        F.TARGET_MOVED,
        targetSource(edit ? `3-${step.id}` : "3"),
      );
      await runner.commit(`phase3 ${step.id}`);
    }
    if (step.commits) await runner.observe(`${step.id}@before`);
    const operation = await runner.analyze(step.id);
    await runner.observe(`${step.id}@after`, { operation });
  }
}

async function runConcurrentAndDirty(runner: Phase3Runner): Promise<{
  concurrentExitCodes: number[];
  dirtyTree: Phase3DirtyTreeObservation;
}> {
  const { sandbox } = runner;
  await runner.write(
    F.CALLER_F,
    callerSource("evalP3CallerF", SPEC_TARGET_MOVED),
  );
  await runner.commit("phase3 C1");
  await runner.observe("C1@before");
  const concurrent = await Promise.all([
    runAnalyze(sandbox, "C1-concurrent-1"),
    runAnalyze(sandbox, "C1-concurrent-2"),
  ]);
  const settle = await runner.analyze("C1");
  await runner.observe("C1@after", {
    operation: settle,
    ungatedOperations: concurrent,
  });

  await runner.write(
    F.CALLER_G,
    callerSource("evalP3CallerG", SPEC_TARGET_MOVED),
  );
  const dirty = await observeTargets(sandbox, [T.TARGET]);
  await runner.remove(F.CALLER_G);
  return {
    concurrentExitCodes: concurrent.map((operation) => operation.exitCode),
    dirtyTree: {
      statusFreshness: dirty.statusFreshness,
      target: dirty.targets[0],
    },
  };
}

async function runRegisteredDefects(
  runner: Phase3Runner,
  t6Sha: string,
): Promise<void> {
  await runner.simpleTransition("T10", async () => {
    await runner.write(F.GROW, oversizedGrowSource());
  });
  await runner.sandbox.runGit(["reset", "-q", "--hard", t6Sha]);
  await runner.observe("T12@before");
  const rewind = await runner.analyze("T12");
  await runner.observe("T12@after", { operation: rewind });
}

/** One complete Phase 3 corpus run from S0 in a new sandbox (contract §2.2, §6). */
export async function runPhase3Corpus(
  distCliPath: string,
): Promise<Phase3CorpusRun> {
  const sandbox = new TestSandbox(distCliPath);
  try {
    await sandbox.setup({ initGit: true, files: PHASE3_S0_FILES });
    const runner = new Phase3Runner(sandbox, distCliPath);
    const reads = await runBaseline(runner);
    const t6Sha = await runEdgeTransitions(runner);
    await runFailureAndInflight(runner);
    await runAccumulation(runner);
    const { concurrentExitCodes, dirtyTree } =
      await runConcurrentAndDirty(runner);
    await runRegisteredDefects(runner, t6Sha);
    return {
      checkpoints: PHASE3_CHECKPOINTS,
      observations: runner.observations,
      evaluation: buildPhase3Evaluation(
        PHASE3_CHECKPOINTS,
        runner.observations,
      ),
      dirtyTree,
      concurrentExitCodes,
      concurrentReads: reads,
      postCommitHookLogExists: existsSync(
        join(sandbox.dir, PHASE3_ARTIFACTS.POST_COMMIT_HOOK_LOG),
      ),
    };
  } finally {
    await sandbox.teardown();
  }
}
